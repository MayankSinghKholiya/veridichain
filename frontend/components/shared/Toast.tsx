"use client";

import { useState, useEffect } from "react";

interface ToastItem {
  id:      string;
  message: string;
  type:    "success" | "error" | "info";
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { message, type } = (e as CustomEvent<{ message: string; type: string }>).detail;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const item: ToastItem = { id, message, type: (type as ToastItem["type"]) };
      setToasts((prev) => [...prev, item]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3600);
    };
    window.addEventListener("veridi:toast", handler);
    return () => window.removeEventListener("veridi:toast", handler);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2.5 pointer-events-none max-w-sm w-full">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-3 rounded-2xl px-5 py-4 border"
          style={{
            background: t.type === "success"
              ? "rgba(10,30,15,0.97)"
              : t.type === "error"
              ? "rgba(35,8,8,0.97)"
              : "rgba(8,22,42,0.97)",
            borderColor: t.type === "success"
              ? "rgba(34,197,94,0.40)"
              : t.type === "error"
              ? "rgba(239,68,68,0.40)"
              : "rgba(14,165,233,0.40)",
            backdropFilter: "blur(20px)",
            boxShadow: t.type === "success"
              ? "0 8px 32px rgba(34,197,94,0.15)"
              : t.type === "error"
              ? "0 8px 32px rgba(239,68,68,0.15)"
              : "0 8px 32px rgba(14,165,233,0.15)",
            animation: "slideInRight 0.25s ease",
          }}
        >
          <span className="text-xl mt-0.5 shrink-0">
            {t.type === "success" ? "✅" : t.type === "error" ? "❌" : "ℹ️"}
          </span>
          <p className={`text-sm font-medium leading-relaxed ${
            t.type === "success" ? "text-green-300" :
            t.type === "error"   ? "text-red-300"   :
            "text-sky-300"
          }`}>
            {t.message}
          </p>
          <button
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            className="ml-auto text-white/20 hover:text-white/50 text-lg leading-none shrink-0 transition-colors"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
