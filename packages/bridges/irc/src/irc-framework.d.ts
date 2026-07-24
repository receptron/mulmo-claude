// Minimal ambient types for `irc-framework`, which ships no declarations and
// has no `@types/` package on npm. Replaces the `@ts-expect-error` that used
// to sit on the import — that suppression made the whole client `any`, so
// every `irc.say(…)` / `irc.on(…)` in this bridge was an unchecked call.
//
// Deliberately covers ONLY the surface this bridge uses. Signatures are read
// off `node_modules/irc-framework/src/client.js`, not guessed:
//
//   class IrcClient extends EventEmitter   (so `on` comes from EventEmitter)
//   connect(options)                       throws if never given options
//   say(target, message, tags)             delegates to sendMessage, which
//                                          returns nothing
//   join(channel, key)
//
// Extend this file when the bridge starts using another method — do not
// reintroduce a blanket suppression.

declare module "irc-framework" {
  import type { EventEmitter } from "node:events";

  export interface IrcClientOptions {
    host?: string;
    port?: number;
    nick?: string;
    username?: string;
    gecos?: string;
    password?: string;
    tls?: boolean;
  }

  export class Client extends EventEmitter {
    connect(options?: IrcClientOptions): void;
    say(target: string, message: string, tags?: Record<string, string>): void;
    join(channel: string, key?: string): void;
  }
}
