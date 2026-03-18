export type AbcProvider = "abc_supply";

export type AbcSearchAccountsParams = {
  soldTo?: string;
  billTo?: string;
  shipTo?: string;
};

export type AbcSearchItemsParams = {
  query?: string;
  itemNumber?: string;
};

export type AbcCreateOrderInput = {
  branchNumber: string;
  soldToNumber: string;
  items: Array<{
    itemNumber: string;
    quantity: number;
  }>;
};