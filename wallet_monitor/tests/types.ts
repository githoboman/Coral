export interface MockCoin {
  coinObjectId: string;
  balance: string;
}

export interface MockNFT {
  objectId: string;
  type: string;
  display?: {
    name?: string;
    description?: string;
  };
}

export interface MockGasResponse {
  result: {
    data: MockCoin[];
  };
}

export interface MockObjectsResponse {
  result: {
    data: {
      data: MockNFT;
    }[];
  };
}

export interface MockNFTDetailsResponse {
  result: {
    data: {
      display: {
        name: string;
        description: string;
      };
    };
  };
}