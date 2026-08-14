import { assessSupplyEffects, type SupplyEffectRecord } from "@interweave/core";

export function runRwaBridgeExample() {
  const at="2026-08-13T12:00:00.000Z",assetId="IW:ASSET:example-rwa"as const,representationId="IW:REPRESENTATION:example-rwa";
  const effects:SupplyEffectRecord[]=[
    {operationId:"IW:BRIDGE:example-forward",effect:"LOCK",assetId,representationId,amount:"100",evidenceId:"canton:offset:10",finalizedAt:at},
    {operationId:"IW:BRIDGE:example-forward",effect:"MINT",assetId,representationId,amount:"100",evidenceId:"evm:block:20",finalizedAt:at}
  ];
  const assessment=assessSupplyEffects(assetId,representationId,effects,at);
  return{example:"Canton RWA to EVM representation",trustBoundary:"Canton finality plus validator threshold authorizes one EVM mint",canton:{issued:"1000",circulating:"900",lockedBacking:assessment.totals.verifiedBacking},evm:{representationSupply:assessment.totals.representationSupply},reconciliation:assessment.outcome};
}
