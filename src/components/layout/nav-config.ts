import {
  AlertTriangle,
  FileStack,
  FlaskConical,
  History,
  LayoutGrid,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  description: string;
};

export const APP_TITLE = "QueryLens";
export const APP_SUBTITLE = "SQL • KPI • Narrative QA";

export const navItems: NavItem[] = [
  {
    title: "Workspace",
    href: "/workspace",
    icon: LayoutGrid,
    description: "Run query analysis, KPI QA, and narrative checks",
  },
  {
    title: "Findings",
    href: "/findings",
    icon: AlertTriangle,
    description: "Track and triage QA findings before release",
  },
  {
    title: "Test Cases",
    href: "/test-cases",
    icon: FlaskConical,
    description: "Generate and track validation test coverage",
  },
  {
    title: "Rewrite",
    href: "/rewrite",
    icon: FileStack,
    description: "Generate guided rewrites grounded in findings",
  },
  {
    title: "History",
    href: "/history",
    icon: History,
    description: "Audit prior sessions and exported artifacts",
  },
  {
    title: "Settings",
    href: "/settings",
    icon: Settings,
    description: "Configure local runtime and workspace defaults",
  },
];
