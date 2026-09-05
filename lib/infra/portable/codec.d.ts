export type PortableConnection={id:string;label:string;provider:string;source:'direct'|'composio'|'native-mcp';authMethod:string;scope:string;fields:Array<{key:string;secret:boolean;configured:boolean}>;values?:Record<string,string>};
export type Bundle={format:'integration-bundle';version:1;producer:{name:string;version:string};exportedAt:string;mode:'metadata'|'secrets';users:Array<{id:string;label:string;connections:PortableConnection[]}>};
export const FORMAT:string,ENCRYPTED:string,MAX_BYTES:number;
export class BundleError extends Error{code:string;}
export function id(value:unknown):string;
export function validate(value:unknown,allowSecrets?:boolean):Bundle;
export function parse(value:unknown):Record<string,unknown>;
export function payload(producer:{name:string;version:string},users:Bundle['users'],mode?:'metadata'|'secrets'):Bundle;
export function seal(payload:Bundle,passphrase:string):Promise<Record<string,unknown>>;
export function open(value:unknown,passphrase?:string):Promise<Bundle>;
