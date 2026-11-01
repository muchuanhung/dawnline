"use client";

import { Badge } from "@/components/ui/badge";
import { AvatarEditor } from "@/components/profile/avatar-editor";

interface ProfileHeaderProps {
  name: string;
  email: string;
  joinedDate: string;
}

export function ProfileHeader({ name, email, joinedDate }: ProfileHeaderProps) {
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
      {/* Avatar with always-visible change button (touch devices have no hover) */}
      <AvatarEditor name={name} />

      {/* Info */}
      <div className="flex flex-col items-center gap-2 sm:items-start">
        <h1 className="text-2xl font-bold tracking-tight text-foreground text-balance">
          {name}
        </h1>
        <p className="text-sm text-muted-foreground">{email}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="secondary"
            className="text-xs text-muted-foreground"
          >
            Joined {joinedDate}
          </Badge>
        </div>
      </div>
    </div>
  );
}
