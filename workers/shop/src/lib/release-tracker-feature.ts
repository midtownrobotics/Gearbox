// The "Released parts" custom feature the release tracker puts in each copied part studio. Its
// FeatureScript lives in Gearbox's public Onshape document, not in this repository; this is the
// fixed pointer to one version of it. To change the feature: edit it there, make a new version,
// and put that version's pointer here (a Gearbox release). Each sync moves the features it wrote
// to the new pointer, since it's part of their signature.
//
// The pointer is d<document>::v<version>::e<Feature Studio>::m<its microversion at that version>
// (GET /documents/d/<document>/v/<version>/elements gives the microversion).
export const FEATURE_NAMESPACE =
  "d32ea49066f596ee1e0443a2b::v02f7f4dd9ab2ce20e4d551e1::e0dcec08563cbe2b11a97f298::mcdcd8c916ede122bb5253346";

const FEATURE_TYPE = "releasedParts";
const STATUS_ENUM = "PartStatus";

/** The feature's Status setting (the FeatureScript enum's values). */
export const PART_STATUSES = ["UNRELEASED", "NOT_STARTED", "IN_PROGRESS", "COMPLETE"] as const;
export type PartStatus = (typeof PART_STATUSES)[number];

export const STATUS_LABELS: Record<PartStatus, string> = {
  UNRELEASED: "Not released",
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
};

/** Where a feature's parts come from: a part studio at a version, by its microversion there. */
export type FeatureSource = {
  documentId: string;
  versionId: string;
  elementId: string;
  microversionId: string;
};

export type FeatureSpec = {
  name: string;
  source: FeatureSource;
  /** The parts' ids at that version. */
  partIds: string[];
  status: PartStatus;
};

/** What a feature is, as one string: a sync rewrites a feature only when this changes. */
export const featureSignature = (spec: FeatureSpec) =>
  JSON.stringify([
    FEATURE_NAMESPACE,
    spec.name,
    spec.source,
    [...spec.partIds].sort(),
    spec.status,
  ]);

/**
 * The feature as Onshape's API takes it (BTMFeature-134). The parts are picked by id; Onshape
 * turns them into its own query when it saves the feature.
 */
export function featureDefinition(spec: FeatureSpec, featureId?: string) {
  const { documentId, versionId, elementId, microversionId } = spec.source;
  return {
    btType: "BTMFeature-134",
    ...(featureId && { featureId }),
    name: spec.name,
    featureType: FEATURE_TYPE,
    namespace: FEATURE_NAMESPACE,
    suppressed: false,
    parameters: [
      {
        btType: "BTMParameterReferencePartStudio-3302",
        parameterId: "source",
        configuration: [],
        namespace: `d${documentId}::v${versionId}::e${elementId}::m${microversionId}`,
        partQuery: {
          btType: "BTMParameterQueryList-148",
          parameterId: "partQuery",
          queries: [
            { btType: "BTMIndividualQuery-138", deterministicIds: [...spec.partIds].sort() },
          ],
        },
      },
      {
        btType: "BTMParameterEnum-145",
        parameterId: "status",
        enumName: STATUS_ENUM,
        namespace: FEATURE_NAMESPACE,
        value: spec.status,
      },
    ],
  };
}
