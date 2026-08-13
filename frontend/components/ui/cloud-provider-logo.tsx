import Image from "next/image";
import { cn } from "@/lib/cn";
import styles from "./cloud-provider-logo.module.css";

export type CloudProviderId = "aws" | "azure" | "gcp";

const providerAssets: Record<
  CloudProviderId,
  { height: number; src: string; width: number }
> = {
  aws: {
    height: 180,
    src: "/assets/aws-2.svg",
    width: 305,
  },
  azure: {
    height: 754,
    src: "/assets/azure-2.svg",
    width: 801,
  },
  gcp: {
    height: 1920,
    src: "/assets/google-cloud-1.svg",
    width: 2386,
  },
};

type CloudProviderLogoProps = {
  className?: string;
  provider: CloudProviderId;
  size?: "sm" | "md" | "lg";
};

export function CloudProviderLogo({
  className,
  provider,
  size = "md",
}: CloudProviderLogoProps) {
  const asset = providerAssets[provider];

  return (
    <span
      aria-hidden="true"
      className={cn(styles.logo, styles[size], styles[provider], className)}
    >
      <Image
        alt=""
        className={styles.image}
        height={asset.height}
        src={asset.src}
        width={asset.width}
      />
    </span>
  );
}
