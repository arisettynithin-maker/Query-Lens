import { ArrowRight, Clock3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type PlaceholderPageProps = {
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  actionLabel: string;
  actionIcon?: LucideIcon;
};

export function PlaceholderPage({
  title,
  description,
  emptyTitle,
  emptyDescription,
  actionLabel,
  actionIcon: ActionIcon = Clock3,
}: PlaceholderPageProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      <Card className="max-w-4xl">
        <CardHeader>
          <CardTitle>{emptyTitle}</CardTitle>
          <CardDescription>{emptyDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <div className="h-3 w-full rounded bg-muted/60" />
            <div className="h-3 w-11/12 rounded bg-muted/50" />
            <div className="h-3 w-9/12 rounded bg-muted/40" />
          </div>
          <Button variant="outline" className="w-fit gap-1.5">
            <ActionIcon className="h-3.5 w-3.5" />
            {actionLabel}
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
