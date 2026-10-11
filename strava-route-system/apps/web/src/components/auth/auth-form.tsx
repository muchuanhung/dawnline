"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  User,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleLogoIcon } from "@/components/auth/google-logo-icon";
import Spinner from "@/components/ui/Spinner";

type AuthMode = "login" | "signup" | "forgot";

const authFormConfig = {
  header: {
    login: { title: "登入或註冊", subtitle: "上傳 GPX，每一段都幫你查好" },
    signup: { title: "歡迎加入", subtitle: "註冊後上傳 GPX，逐段看路況" },
    forgot: { title: "重置密碼", subtitle: "輸入您的電子郵件以接收重置連結" },
  },
  googleButton: "使用 Google 登入",
  divider: "or",
  form: {
    nameLabel: "全名",
    namePlaceholder: "您的全名",
    emailLabel: "Email",
    emailPlaceholder: "您的電子郵件",
    passwordLabel: "Password",
    passwordPlaceholder: "輸入您的密碼",
    forgotPasswordLink: "忘記密碼嗎？",
    submit: { login: "登入", signup: "註冊", forgot: "發送重置信" },
    showPasswordAria: "顯示密碼",
    hidePasswordAria: "隱藏密碼",
  },
  toggle: {
    login: { prompt: "還沒有帳號嗎？ ", linkText: "註冊" },
    signup: { prompt: "已經有帳號了嗎？ ", linkText: "登入" },
    forgot: { prompt: "記得密碼嗎？ ", linkText: "返回登入" },
  },
  messages: {
    forgotSuccess: "重設信已寄出，請檢查信箱",
    authError: "登入失敗",
    googleError: "Google 登入失敗",
  },
} as const;

interface AuthFormProps {
  onGoogleAuth: () => Promise<void>;
  onEmailAuth: (email: string, password: string, name?: string) => Promise<void>;
  onForgotPassword: (email: string) => Promise<void>;
}

type FormData = { email: string; password: string; name: string };

export function AuthForm({
  onGoogleAuth,
  onEmailAuth,
  onForgotPassword,
}: AuthFormProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [formData, setFormData] = useState<FormData>({
    email: "",
    password: "",
    name: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target;
    setFormData((prev) => ({ ...prev, [id]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setIsLoading(true);

    try {
      if (mode === "forgot") {
        await onForgotPassword(formData.email);
        setSuccess(authFormConfig.messages.forgotSuccess);
      } else {
        await onEmailAuth(
          formData.email,
          formData.password,
          mode === "signup" ? formData.name : undefined
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : authFormConfig.messages.authError);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setError(null);
    setIsGoogleLoading(true);
    try {
      await onGoogleAuth();
    } catch (err) {
      const msg = err instanceof Error ? err.message : authFormConfig.messages.googleError;
      const friendly =
        msg.includes("popup-closed-by-user") || msg.includes("cancelled-popup-request")
          ? "登入已取消"
          : msg;
      setError(friendly);
    } finally {
      setIsGoogleLoading(false);
    }
  };

  const formVariants = {
    hidden: { opacity: 0, x: 20 },
    visible: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
  };

  return (
    <div className="w-full max-w-md">
      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          variants={formVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={{ duration: 0.3, ease: "easeInOut" }}
        >
          {/* Header */}
          <div className="mb-8 text-center">
            <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">
              {authFormConfig.header[mode].title}
            </h1>
            <p className="text-muted-foreground">
              {authFormConfig.header[mode].subtitle}
            </p>
          </div>

          {/* Error/Success Alerts */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-4"
              >
                <Alert variant="destructive" className="border-destructive/50 bg-destructive/10">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </motion.div>
            )}
            {success && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mb-4"
              >
                <Alert className="border-success/50 bg-success/10 text-success">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{success}</AlertDescription>
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Google Auth Button */}
          {mode !== "forgot" && (
            <Button
              type="button"
              variant="outline"
              className="mb-6 h-12 w-full gap-3 border-border bg-card text-foreground transition-all hover:border-primary/50 hover:bg-card/80"
              onClick={handleGoogleAuth}
              disabled={isGoogleLoading || isLoading}
            >
              {isGoogleLoading ? (
                <Spinner size="sm" dotClassName="bg-current" />
              ) : (
                <GoogleLogoIcon size={20} />
              )}
              <span>{authFormConfig.googleButton}</span>
            </Button>
          )}

          {/* Divider */}
          {mode !== "forgot" && (
            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-background px-4 text-muted-foreground">
                  {authFormConfig.divider}
                </span>
              </div>
            </div>
          )}

          {/* Email Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2"
              >
                <Label htmlFor="name" className="text-foreground">
                  {authFormConfig.form.nameLabel}
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="name"
                    type="text"
                    placeholder={authFormConfig.form.namePlaceholder}
                    value={formData.name}
                    onChange={onChange}
                    className="h-12 bg-card pl-10 text-foreground placeholder:text-muted-foreground"
                    required
                  />
                </div>
              </motion.div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-foreground">
                {authFormConfig.form.emailLabel}
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder={authFormConfig.form.emailPlaceholder}
                  value={formData.email}
                  onChange={onChange}
                  className="h-12 bg-card pl-10 text-foreground placeholder:text-muted-foreground"
                  required
                />
              </div>
            </div>

            {mode !== "forgot" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-foreground">
                    {authFormConfig.form.passwordLabel}
                  </Label>
                  {mode === "login" && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode("forgot");
                        setError(null);
                        setSuccess(null);
                      }}
                      className="text-sm text-primary hover:text-primary/80 hover:underline"
                    >
                      {authFormConfig.form.forgotPasswordLink}
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder={authFormConfig.form.passwordPlaceholder}
                    value={formData.password}
                    onChange={onChange}
                    className="h-12 bg-card pl-10 pr-10 text-foreground placeholder:text-muted-foreground"
                    required
                    minLength={6}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={
                      showPassword
                        ? authFormConfig.form.hidePasswordAria
                        : authFormConfig.form.showPasswordAria
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            )}

            <Button
              type="submit"
              className="h-12 w-full bg-primary text-primary-foreground transition-all hover:bg-primary/90"
              disabled={isLoading || isGoogleLoading}
            >
              {isLoading ? (
                <Spinner size="sm" className="mr-2" dotClassName="bg-current" />
              ) : null}
              {authFormConfig.form.submit[mode]}
            </Button>
          </form>

          {/* Mode Toggle */}
          <div className="mt-6 text-center text-sm text-muted-foreground">
            {(() => {
              const { prompt, linkText } = authFormConfig.toggle[mode];
              const goTo = (m: AuthMode) => () => {
                setMode(m);
                setError(null);
                setSuccess(null);
              };
              const nextMode: Record<AuthMode, AuthMode> = {
                login: "signup",
                signup: "login",
                forgot: "login",
              };
              return (
                <>
                  {prompt}
                  <button
                    type="button"
                    onClick={goTo(nextMode[mode])}
                    className="font-medium text-primary hover:text-primary/80 hover:underline"
                  >
                    {linkText}
                  </button>
                </>
              );
            })()}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}