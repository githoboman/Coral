import { IkaClient, getNetworkConfig, type Network } from "@ika.xyz/sdk";
import { SuiClient } from "@mysten/sui/client";
import { config } from "../config";
import { logger } from "../utils/logger";

let _ikaClient: IkaClient | null = null;
let _suiClient: SuiClient | null = null;

export function getSuiClient(): SuiClient {
  if (!_suiClient) {
    const rpcUrl = config.ika.suiRpcUrl;
    _suiClient = new SuiClient({ url: rpcUrl });
    logger.debug("SuiClient initialized", { rpcUrl });
  }
  return _suiClient;
}

export async function getIkaClient(): Promise<IkaClient> {
  if (!_ikaClient) {
    const suiClient = getSuiClient();

    const networkConfig = getNetworkConfig(config.ika.network as Network);

    _ikaClient = new IkaClient({
      suiClient,
      config: networkConfig,
    });

    logger.info("Initializing IkaClient...");
    await _ikaClient.initialize();
    logger.success("IkaClient ready", { network: config.ika.network });
  }
  return _ikaClient;
}

export async function getCurrentEpoch(): Promise<number> {
  const client = await getIkaClient();
  return client.getEpoch();
}
