import { PageHeader, BackLink } from "../components/PageHeader";
import { FeatureCatalog } from "./FeatureCatalog";

export function FeatureCatalogPage() {
  return (
    <div className="flex flex-col gap-6 p-5 sm:p-8 max-w-7xl mx-auto w-full">
      <BackLink to="/dashboard" label="Back to Recovery Queue" />
      <PageHeader
        eyebrow="System Architecture & Catalog"
        title="Features & Data Flow Specification"
        description="Comprehensive technical guide to all 16 subsystems of the Recovery Value Engine, detailing exact algorithmic mechanisms, data flow pipelines, and AI boundaries."
        badge="Live Blueprint"
        badgeTone="neutral"
      />

      <FeatureCatalog isModal={false} />
    </div>
  );
}
