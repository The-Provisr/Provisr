import type { Metadata } from "next";
import { LandingPage } from "../components/landing/landing-page";

export const metadata: Metadata = {
  title: "Provisr — Cloud infrastructure, governed by default",
  description:
    "Describe the infrastructure you need. Provisr plans, validates, approves, and provisions it across AWS, Azure, and Google Cloud.",
};

export default function HomePage() {
  return <LandingPage />;
}
