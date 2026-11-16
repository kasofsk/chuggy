import {
  workerContractFeatures,
  workerContractFeaturesText,
  type WorkerContractFeature,
} from "../contract/workerContract.ts";

/** The features header a client this tree builds sends: every feature in the roster, since it is built from the whole contract. */
export const workerContractClientFeatures = workerContractFeaturesText(
  Object.keys(workerContractFeatures) as WorkerContractFeature[],
);
