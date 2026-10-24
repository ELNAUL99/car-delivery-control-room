import { redirect } from "next/navigation"

// The onboarding now lives at the home page; keep this path working for old links.
export default function Welcome() {
  redirect("/")
}
