"use client";

import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

import { Sidebar } from "@/components/layout/sidebar";
import { TopHeader } from "@/components/layout/top-header";
import { OllamaProvider } from "@/components/ollama/ollama-provider";
import { ReviewSessionProvider } from "@/components/review/review-session-provider";
import { SettingsProvider } from "@/components/settings/settings-provider";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: React.ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const currentPath = useMemo(() => pathname ?? "/workspace", [pathname]);

  return (
    <SettingsProvider>
      <OllamaProvider>
        <ReviewSessionProvider>
          <div className="min-h-screen bg-background text-foreground">
            <div className="flex min-h-screen">
              <Sidebar collapsed={collapsed} currentPath={currentPath} />
              <div className="flex min-w-0 flex-1 flex-col">
                <TopHeader
                  collapsed={collapsed}
                  onToggleSidebar={() => setCollapsed((previous) => !previous)}
                  currentPath={currentPath}
                />
                <main
                  className={cn(
                    "flex-1 w-full mx-auto px-4 py-5 lg:px-5 2xl:px-7",
                    collapsed ? "2xl:max-w-[1780px]" : "2xl:max-w-[1860px]",
                  )}
                >
                  {children}
                </main>
              </div>
            </div>
          </div>
        </ReviewSessionProvider>
      </OllamaProvider>
    </SettingsProvider>
  );
}
