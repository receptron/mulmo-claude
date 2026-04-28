// Minimal type declarations for @xmpp/client (the package ships CommonJS
// without .d.ts). We only use the surface exercised by this bridge.
/* eslint-disable @typescript-eslint/method-signature-style */

declare module "@xmpp/client" {
  export interface XmlElement {
    is(name: string): boolean;
    attrs: Record<string, string | undefined>;
    getChildText(name: string): string | null;
  }

  interface Address {
    toString(): string;
  }

  interface XmppClient {
    start(): Promise<void>;
    stop(): Promise<void>;
    send(element: XmlElement): Promise<void>;
    on(event: "error", listener: (err: Error) => void): void;
    on(event: "online", listener: (address: Address) => void): void;
    on(event: "offline", listener: () => void): void;
    on(event: "stanza", listener: (stanza: XmlElement) => void): void;
  }

  interface ClientOptions {
    service: string;
    domain?: string;
    username?: string;
    password?: string;
    resource?: string;
  }

  export function client(options: ClientOptions): XmppClient;
  export function xml(name: string, attrs?: Record<string, string>, ...children: (string | XmlElement)[]): XmlElement;

  const defaultExport: {
    client: typeof client;
    xml: typeof xml;
  };
  export default defaultExport;
}
