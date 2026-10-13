"use client";

import { useState, useCallback, useEffect, useRef, createContext, useContext } from "react";
import { motion } from "framer-motion";
import {
  Camera,
  ExternalLink,
  Maximize2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import type { CCTVFeed } from "@/lib/routes/route-data";
import { isBlockedByCSP, isRateLimited, hasWhiteBorderInEmbed } from "@/lib/cctv/embed-policy";

const MAX_CONCURRENT_IFRAMES = 6;

type VisibilityContextValue = {
  registerVisibility: (id: string, visible: boolean) => void;
  canShowIframe: (id: string) => boolean;
};

const VisibilityContext = createContext<VisibilityContextValue | null>(null);

interface CCTVGalleryProps {
  feeds: CCTVFeed[];
  loading?: boolean;
}

export function CCTVGallery({ feeds, loading }: CCTVGalleryProps) {
  const [orderedVisibleIds, setOrderedVisibleIds] = useState<string[]>([]);
  const [selectedTownships, setSelectedTownships] = useState<Set<string>>(new Set());

  const townships = [...new Set(feeds.map((f) => f.township).filter(Boolean))] as string[];
  const showAll = selectedTownships.size === 0;
  const filteredFeeds = showAll
    ? feeds
    : feeds.filter((f) => f.township && selectedTownships.has(f.township));

  const toggleTownship = useCallback((t: string) => {
    setSelectedTownships((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => setSelectedTownships(new Set()), []);

  const registerVisibility = useCallback((id: string, visible: boolean) => {
    setOrderedVisibleIds((prev) => {
      if (visible) {
        if (prev.includes(id)) return prev;
        return [...prev, id];
      }
      return prev.filter((x) => x !== id);
    });
  }, []);

  const canShowIframe = useCallback(
    (id: string) => orderedVisibleIds.slice(0, MAX_CONCURRENT_IFRAMES).includes(id),
    [orderedVisibleIds]
  );

  useEffect(() => {
    setOrderedVisibleIds([]);
    setSelectedTownships(new Set());
  }, [feeds]);

  if (feeds.length === 0 && !loading) return null;

  return (
    <VisibilityContext.Provider value={{ registerVisibility, canShowIframe }}>
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2, ease: "easeOut" }}
      className="rounded-xl border border-border/40 bg-card/40 overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-strava" />
            <h3 className="text-sm font-semibold text-foreground">
              即時影像
            </h3>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            TDX CCTV 監視器
          </p>
        </div>
        <Badge variant="outline" className="text-muted-foreground text-[10px] px-2 py-0.5">
          {loading ? "載入中…" : `${feeds.length} 台`}
        </Badge>
      </div>

      {townships.length > 0 && (
        <div className="px-4 pb-3 pt-0 -mx-1">
          <div className="flex gap-2 overflow-x-auto pb-1 touch-pan-x">
            <button
              type="button"
              onClick={selectAll}
              className={`shrink-0 min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium transition-colors touch-manipulation ${
                showAll
                  ? "bg-strava text-primary-foreground"
                  : "bg-secondary/50 text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
              }`}
            >
              全部
            </button>
            {townships.sort().map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleTownship(t)}
                className={`shrink-0 min-h-[44px] px-4 py-2 rounded-lg text-sm font-medium transition-colors touch-manipulation ${
                  selectedTownships.has(t)
                    ? "bg-strava text-primary-foreground"
                    : "bg-secondary/50 text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {loading && feeds.length === 0 ? (
          <div className="col-span-2 flex items-center justify-center py-12 text-muted-foreground text-sm">
            載入路線附近監視器…
          </div>
        ) : filteredFeeds.length === 0 ? (
          <div className="col-span-2 flex items-center justify-center py-8 text-muted-foreground text-sm">
            {showAll ? "此路線附近無監視器" : `${[...selectedTownships].join("、")} 無監視器`}
          </div>
        ) : (
          filteredFeeds.map((feed, i) => (
            <CCTVCard key={feed.id} feed={feed} index={i} />
          ))
        )}
      </div>
    </motion.div>
    </VisibilityContext.Provider>
  );
}

function CCTVCard({ feed, index }: { feed: CCTVFeed; index: number }) {
  const ctx = useContext(VisibilityContext);
  const cardRef = useRef<HTMLDivElement>(null);

  const needsSlot = feed.videoUrl && isRateLimited(feed.videoUrl);
  const hasSlot = ctx ? ctx.canShowIframe(feed.id) : true;

  useEffect(() => {
    if (!ctx || !needsSlot || !cardRef.current) return;
    const el = cardRef.current;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry) ctx.registerVisibility(feed.id, entry.isIntersecting);
      },
      { rootMargin: "50px", threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ctx, feed.id, needsSlot]);

  const showCardIframe =
    feed.videoUrl &&
    !isBlockedByCSP(feed.videoUrl) &&
    (!needsSlot || hasSlot);

  const needsScaleFix = hasWhiteBorderInEmbed(feed.videoUrl);

  // Deterministic "image" generated via SVG noise pattern
  const seed = feed.imageSeed;
  const hue1 = (seed * 37) % 360;
  const hue2 = (seed * 73 + 120) % 360;

  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, delay: index * 0.06 }}
      className="rounded-lg border border-border/30 bg-secondary/20 overflow-hidden group"
    >
      {/* Camera view placeholder */}
      <Dialog>
        <div className="relative h-32 overflow-hidden">
          {showCardIframe ? (
            <iframe
              src={feed.videoUrl}
              title={feed.label}
              className={`absolute inset-0 w-full h-full border-0 bg-[#0a1020] origin-center ${
                needsScaleFix ? "scale-[1.5]" : ""
              }`}
              allow="autoplay; fullscreen"
            />
          ) : (
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 128" preserveAspectRatio="none">
              <defs>
                <radialGradient id={`cg-${seed}`} cx="50%" cy="50%">
                  <stop offset="0%" stopColor={`hsl(${hue1}, 30%, 18%)`} />
                  <stop offset="100%" stopColor={`hsl(${hue2}, 20%, 8%)`} />
                </radialGradient>
                <filter id={`noise-${seed}`}>
                  <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" seed={seed} />
                  <feColorMatrix type="saturate" values="0" />
                  <feBlend in="SourceGraphic" mode="overlay" />
                </filter>
              </defs>
              <rect width="320" height="128" fill={`url(#cg-${seed})`} />
              <line
                x1="0" y1={80 + (seed % 20)} x2="320" y2={75 + (seed % 15)}
                stroke="rgba(255,255,255,0.06)" strokeWidth="40"
              />
              <line
                x1="0" y1={80 + (seed % 20)} x2="320" y2={75 + (seed % 15)}
                stroke="rgba(255,255,255,0.08)" strokeWidth="2" strokeDasharray="20,15"
              />
              <line x1="0" y1={50 + (seed % 10)} x2="320" y2={48 + (seed % 8)} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
            </svg>
          )}

          {(!feed.videoUrl || isBlockedByCSP(feed.videoUrl)) && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.05) 2px, rgba(0,0,0,0.05) 4px)",
              }}
            />
          )}

          {feed.videoUrl && isBlockedByCSP(feed.videoUrl) && (
            <a
              href={feed.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              aria-label={`在新分頁開啟 ${feed.label}`}
            >
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background/90 text-xs font-medium text-foreground">
                <ExternalLink className="h-3.5 w-3.5" />
                {needsSlot && !hasSlot ? "點擊或滾動至上方載入" : "觀看即時影像"}
              </span>
            </a>
          )}

          {/* Expand button */}
          <DialogTrigger asChild>
            <button
              type="button"
              className="absolute bottom-2 right-2 h-7 w-7 flex items-center justify-center rounded-md bg-background/30 backdrop-blur-sm text-muted-foreground hover:text-foreground hover:bg-background/50 transition-all opacity-70 md:opacity-0 md:group-hover:opacity-100 cursor-pointer touch-manipulation"
              aria-label={`Expand ${feed.label} camera view`}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </DialogTrigger>

          {/* Camera label overlay */}
          <div className="absolute bottom-2 left-2 bg-background/40 backdrop-blur-sm rounded px-2 py-0.5">
            <span className="text-[10px] font-medium text-foreground">{feed.location}</span>
          </div>

        </div>

        <DialogContent className="max-w-2xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Camera className="h-4 w-4 text-strava" />
              {feed.label} - {feed.location}
            </DialogTitle>
          </DialogHeader>
          <div className="relative h-80 bg-[#0a1020] rounded-lg overflow-hidden">
            {feed.videoUrl && !isBlockedByCSP(feed.videoUrl) ? (
              <iframe
                src={feed.videoUrl}
                title={feed.label}
                className={`absolute inset-0 w-full h-full border-0 bg-[#0a1020] origin-center ${
                  hasWhiteBorderInEmbed(feed.videoUrl) ? "scale-[1.5]" : ""
                }`}
                allow="autoplay; fullscreen"
              />
            ) : (
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 640 320" preserveAspectRatio="none">
                <defs>
                  <radialGradient id={`cg-lg-${seed}`} cx="50%" cy="50%">
                    <stop offset="0%" stopColor={`hsl(${hue1}, 30%, 18%)`} />
                    <stop offset="100%" stopColor={`hsl(${hue2}, 20%, 8%)`} />
                  </radialGradient>
                </defs>
                <rect width="640" height="320" fill={`url(#cg-lg-${seed})`} />
                <line
                  x1="0" y1={180 + (seed % 20)} x2="640" y2={170 + (seed % 15)}
                  stroke="rgba(255,255,255,0.06)" strokeWidth="80"
                />
                <line
                  x1="0" y1={180 + (seed % 20)} x2="640" y2={170 + (seed % 15)}
                  stroke="rgba(255,255,255,0.08)" strokeWidth="3" strokeDasharray="30,20"
                />
              </svg>
            )}
            {feed.videoUrl && isBlockedByCSP(feed.videoUrl) && (
              <a
                href={feed.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50"
              >
                <p className="text-sm text-foreground/90">此影像因安全政策無法嵌入</p>
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-strava text-white text-sm font-medium hover:bg-strava/90 transition-colors">
                  <ExternalLink className="h-4 w-4" />
                  在新分頁開啟即時影像
                </span>
              </a>
            )}
          </div>
          <DialogClose asChild>
            <Button variant="outline" size="sm" className="w-fit ml-auto">
              <X className="h-3.5 w-3.5 mr-1.5" />
              關閉
            </Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}