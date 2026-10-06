import { redirect } from "next/navigation";
import { requireUser, ROLES_BUREAU } from "@/lib/auth-helpers";

// Phase 24 : les règles de planification par appareil sont remplacées par les
// prestations « contrat à passages » (catalogue -> projet -> passages par appareil).
export default async function PlanificationPage() {
  await requireUser(ROLES_BUREAU);
  redirect("/responsable/prestations-catalogue");
}
