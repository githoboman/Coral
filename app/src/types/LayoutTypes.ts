export type LayoutContextType = {
  toggleWallet: () => void;
  walletBalanceUSD: string;
  setMobileActions?: (
    actions: {
      onRecentClick?: () => void;
      onNewClick?: () => void;
      onTransactionsClick?: () => void;
      customAction?: React.ReactNode;
    } | null,
  ) => void;
  tokens?: any[];
};
