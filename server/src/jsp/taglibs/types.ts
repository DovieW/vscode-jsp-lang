export type TaglibAttribute = {
  name: string;
  required?: boolean;
  rtexprvalue?: boolean;
  type?: string;
  description?: string;
};

export type TaglibTag = {
  name: string;
  description?: string;
  attributes: Map<string, TaglibAttribute>;
};

export type Taglib = {
  uri?: string;
  shortName?: string;
  displayName?: string;
  source: string;
  tags: Map<string, TaglibTag>;
};

export type TaglibIndex = {
  byUri: Map<string, Taglib>;
  builtAtMs: number;
  tldFileCount: number;
  parseErrorCount: number;
  roots: string[];
};
