"use client";

import Link from "next/link";

import { APP_SUBTITLE, APP_TITLE, navItems } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SidebarProps = {
  collapsed: boolean;
  currentPath: string;
  onItemClick?: () => void;
};

export function Sidebar({ collapsed, currentPath, onItemClick }: SidebarProps) {
  return (
    <aside
      className={cn(
        "hidden h-screen shrink-0 border-r border-sidebar-border bg-sidebar px-3 py-4 lg:flex lg:flex-col",
        collapsed ? "w-[88px]" : "w-[272px]",
      )}
    >
      <div className="mb-6 rounded-lg border border-sidebar-border/70 bg-muted/35 p-3.5">
        {!collapsed ? (
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-semibold tracking-tight leading-none">{APP_TITLE}</p>
            <p className="line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
              {APP_SUBTITLE}
            </p>
          </div>
        ) : null}
      </div>
      <nav className="space-y-1">
        {navItems.map((item) => {
          const isActive = currentPath === item.href;
          return (
            <Link key={item.href} href={item.href} onClick={onItemClick}>
              <Button
                variant={isActive ? "secondary" : "ghost"}
                className={cn(
                  "h-10 w-full justify-start gap-3 px-3 text-sm",
                  isActive
                    ? "bg-accent text-accent-foreground hover:bg-accent/90"
                    : "text-sidebar-foreground hover:bg-muted/50",
                  collapsed && "justify-center px-0",
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed ? <span>{item.title}</span> : null}
              </Button>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-sidebar-border/80 pt-4">
        {!collapsed ? (
          <p className="px-1 text-[11px] text-muted-foreground/80">
            QueryLens • Built for analytics teams
          </p>
        ) : null}
      </div>
    </aside>
  );
}
