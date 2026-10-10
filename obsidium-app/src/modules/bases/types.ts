export type BaseScalar = string | number | boolean | null;
export type BaseFilter = string | {
  and?: BaseFilter[];
  or?: BaseFilter[];
  not?: BaseFilter | BaseFilter[];
};

export interface BaseGroupBy {
  property: string;
  direction?: 'ASC' | 'DESC';
}

export interface BaseSort {
  property: string;
  direction?: 'ASC' | 'DESC';
}

export interface BaseViewDefinition {
  type: string;
  name: string;
  limit?: number;
  order: string[];
  filters?: BaseFilter;
  groupBy?: BaseGroupBy;
  groupOrder?: BaseScalar[];
  sort?: BaseSort[];
}

export interface BaseDefinition {
  raw: string;
  filters?: BaseFilter;
  views: BaseViewDefinition[];
  propertyLabels: Record<string, string>;
  unsupportedKeys: string[];
}

export type BaseFieldValue = string | string[] | number | boolean | null;

export interface BaseRow {
  path: string;
  fields: Record<string, BaseFieldValue>;
}
