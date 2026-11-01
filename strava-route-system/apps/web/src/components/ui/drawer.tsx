"use client";

import * as React from "react";
import { Drawer as VaulDrawer } from "vaul";
import { cn } from "@/lib/utils";

function Drawer({
  open,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof VaulDrawer.Root>) {
  return (
    <VaulDrawer.Root open={open} onOpenChange={onOpenChange} {...props} />
  );
}
Drawer.displayName = "Drawer";

function DrawerTrigger({
  ...props
}: React.ComponentProps<typeof VaulDrawer.Trigger>) {
  return <VaulDrawer.Trigger {...props} />;
}
DrawerTrigger.displayName = "DrawerTrigger";

function DrawerPortal({
  ...props
}: React.ComponentProps<typeof VaulDrawer.Portal>) {
  return <VaulDrawer.Portal {...props} />;
}
DrawerPortal.displayName = "DrawerPortal";

function DrawerClose({
  ...props
}: React.ComponentProps<typeof VaulDrawer.Close>) {
  return <VaulDrawer.Close {...props} />;
}
DrawerClose.displayName = "DrawerClose";

function DrawerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof VaulDrawer.Content>) {
  return (
    <DrawerPortal>
      <VaulDrawer.Overlay className="fixed inset-0 z-50 bg-black/80" />
      <VaulDrawer.Content
        className={cn(
          // md (tablet portrait, 768-1023px) and up: cap width and center, so sheets don't span the whole tablet
          "fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-[10px] border border-border bg-background md:mx-auto md:max-w-xl",
          className
        )}
        {...props}
      >
        <div className="mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted" />
        {children}
      </VaulDrawer.Content>
    </DrawerPortal>
  );
}
DrawerContent.displayName = "DrawerContent";

function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "grid gap-1.5 p-4 text-center sm:text-left",
        className
      )}
      {...props}
    />
  );
}
DrawerHeader.displayName = "DrawerHeader";

function DrawerFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-auto flex flex-col gap-2 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  );
}
DrawerFooter.displayName = "DrawerFooter";

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof VaulDrawer.Title>) {
  return (
    <VaulDrawer.Title
      className={cn(
        "text-lg font-semibold leading-none tracking-tight",
        className
      )}
      {...props}
    />
  );
}
DrawerTitle.displayName = "DrawerTitle";

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof VaulDrawer.Description>) {
  return (
    <VaulDrawer.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}
DrawerDescription.displayName = "DrawerDescription";

export {
  Drawer,
  DrawerPortal,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
