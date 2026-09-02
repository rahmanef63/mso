// Data contract shared by the runtime host and its console. Keeping it separate
// prevents the two rendering components from importing each other for a type.
export type AppManifest = {
  title: string;
  runtime: string;
  entry: string;
  source: string;
};
