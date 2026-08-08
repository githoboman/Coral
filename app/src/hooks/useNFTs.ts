import { useState, useCallback, useMemo, useEffect } from "react";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";

export interface NFT {
  id: string;
  name: string;
  image: string;
  type: string;
  description?: string;
}

export function useNFTs(address: string | null) {
  const [nfts, setNfts] = useState<NFT[]>([]);
  const [isFetching, setIsFetching] = useState(false);

  const suiClient = useMemo(() => {
    const network = (import.meta.env.VITE_SUI_NETWORK || "testnet") as
      | "testnet"
      | "mainnet";
    return new SuiClient({
      url: getFullnodeUrl(network),
    });
  }, []);

  const fetchNFTs = useCallback(async () => {
    if (!address) {
      setNfts([]);
      return;
    }

    setIsFetching(true);
    try {
      const result = await suiClient.getOwnedObjects({
        owner: address,
        options: {
          showDisplay: true,
          showType: true,
          showContent: true,
        },
      });

      const parsedNfts: NFT[] = (result.data
        .map((obj) => {
          const display = obj.data?.display?.data || {};
          const content = obj.data?.content;
          const type = obj.data?.type || "";

          // Skip coins
          if (type.includes("0x2::coin::Coin")) return null;

          const name = display?.name || (content as any)?.fields?.name || "";
          const image = display?.image_url || display?.img_url || (content as any)?.fields?.url || (content as any)?.fields?.image_url || "";
          const description = display?.description || (content as any)?.fields?.description;

          // Tighten filtering: Must have a legitimate name and an image
          if (!name || name.toLowerCase().includes("unknown") || !image) return null;

          return {
            id: obj.data?.objectId || "",
            name,
            image: typeof image === 'string' && image.startsWith("ipfs://") 
              ? image.replace("ipfs://", "https://ipfs.io/ipfs/") 
              : String(image || ""),
            type,
            description: description ? String(description) : undefined,
          };
        })
        .filter((nft) => nft !== null)) as NFT[];

      setNfts(parsedNfts);
    } catch (err) {
      console.error("[useNFTs] Failed to fetch NFTs:", err);
    } finally {
      setIsFetching(false);
    }
  }, [address, suiClient]);

  useEffect(() => {
    fetchNFTs();
  }, [fetchNFTs]);

  return {
    nfts,
    isFetching,
    refetch: fetchNFTs,
  };
}
