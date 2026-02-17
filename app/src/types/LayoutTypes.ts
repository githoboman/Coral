export type LayoutContextType = {
  toggleWallet: () => void;
  walletBalanceUSD: string;
  setMobileActions?: (
    actions: {
      onRecentClick?: () => void;
      onNewClick?: () => void;
      customAction?: React.ReactNode;
    } | null,
  ) => void;
  tokens?: any[];
};
