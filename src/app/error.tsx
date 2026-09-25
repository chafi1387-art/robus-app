"use client";

import { ErreurPage } from "@/components/erreur-page";

export default function Erreur(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErreurPage {...props} />;
}
