"use client";

import Link from "next/link";
import { Menu, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { APP_SUBTITLE, APP_TITLE, navItems } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type MobileNavProps = {
  currentPath: string;
};

export function MobileNav({ currentPath }: MobileNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="lg:hidden">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            {APP_TITLE}
          </SheetTitle>
          <SheetDescription>{APP_SUBTITLE}</SheetDescription>
        </SheetHeader>
        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = currentPath === item.href;
            return (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className={cn(
                    "h-10 w-full justify-start gap-3 px-3",
                    isActive && "bg-accent text-accent-foreground hover:bg-accent/90",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.title}
                </Button>
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
