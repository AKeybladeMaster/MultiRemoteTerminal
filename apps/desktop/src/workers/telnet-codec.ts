import type { TerminalSize } from '../../../../packages/domain/src/local-terminal.ts';

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;
const BINARY = 0;
const ECHO = 1;
const SUPPRESS_GO_AHEAD = 3;
const TERMINAL_TYPE = 24;
const WINDOW_SIZE = 31;
const TERMINAL_TYPE_IS = 0;
const TERMINAL_TYPE_SEND = 1;
const MAX_SUBNEGOTIATION_BYTES = 512;
const TERMINAL_NAME = new TextEncoder().encode('XTERM-256COLOR');

type ParserState = 'data' | 'iac' | 'option' | 'subnegotiation-option' | 'subnegotiation' | 'subnegotiation-iac';
type OptionState = 'pending' | 'enabled' | 'refused' | 'disabled';

export interface TelnetDecodeResult {
  readonly data: Uint8Array;
  readonly replies: readonly Uint8Array[];
}

export class TelnetCodec {
  private state: ParserState = 'data';
  private optionVerb = 0;
  private subnegotiationOption = 0;
  private subnegotiation: number[] = [];
  private subnegotiationOverflow = false;
  private readonly localOptions = new Map<number, OptionState>();
  private readonly remoteOptions = new Map<number, OptionState>();
  private size: TerminalSize;
  private terminalTypeReported = false;

  constructor(size: TerminalSize) {
    this.size = size;
  }

  start(): Uint8Array {
    const requests: number[] = [];
    this.requestLocal(BINARY, requests);
    this.requestRemote(BINARY, requests);
    this.requestLocal(SUPPRESS_GO_AHEAD, requests);
    this.requestRemote(SUPPRESS_GO_AHEAD, requests);
    this.requestLocal(TERMINAL_TYPE, requests);
    this.requestLocal(WINDOW_SIZE, requests);
    return Uint8Array.from(requests);
  }

  receive(input: Uint8Array): TelnetDecodeResult {
    const output: number[] = [];
    const replies: number[][] = [];
    for (const byte of input) {
      switch (this.state) {
        case 'data':
          if (byte === IAC) this.state = 'iac';
          else output.push(byte);
          break;
        case 'iac':
          this.consumeIac(byte, output);
          break;
        case 'option':
          this.consumeOption(byte, replies);
          this.state = 'data';
          break;
        case 'subnegotiation-option':
          this.subnegotiationOption = byte;
          this.subnegotiation = [];
          this.subnegotiationOverflow = false;
          this.state = 'subnegotiation';
          break;
        case 'subnegotiation':
          if (byte === IAC) this.state = 'subnegotiation-iac';
          else this.appendSubnegotiation(byte);
          break;
        case 'subnegotiation-iac':
          if (byte === SE) {
            this.completeSubnegotiation(replies);
            this.state = 'data';
          } else if (byte === IAC) {
            this.appendSubnegotiation(IAC);
            this.state = 'subnegotiation';
          } else {
            // Ignore Telnet commands embedded in an option payload while keeping its size bounded.
            this.state = 'subnegotiation';
          }
          break;
      }
    }
    return { data: Uint8Array.from(output), replies: replies.map(reply => Uint8Array.from(reply)) };
  }

  resize(size: TerminalSize): Uint8Array | undefined {
    this.size = size;
    return this.localOptions.get(WINDOW_SIZE) === 'enabled' ? this.windowSizeCommand() : undefined;
  }

  encodeInput(text: string): Uint8Array {
    const bytes = new TextEncoder().encode(text);
    const encoded: number[] = [];
    const binary = this.localOptions.get(BINARY) === 'enabled';
    for (let index = 0; index < bytes.length; index += 1) {
      const byte = bytes[index]!;
      if (!binary && byte === 13) {
        encoded.push(13);
        if (bytes[index + 1] === 10) { encoded.push(10); index += 1; }
        else encoded.push(0);
      } else if (!binary && byte === 10) encoded.push(13, 10);
      else if (byte === IAC) encoded.push(IAC, IAC);
      else encoded.push(byte);
    }
    return Uint8Array.from(encoded);
  }

  private consumeIac(byte: number, output: number[]): void {
    if (byte === IAC) { output.push(IAC); this.state = 'data'; return; }
    if (byte === DO || byte === DONT || byte === WILL || byte === WONT) {
      this.optionVerb = byte;
      this.state = 'option';
      return;
    }
    if (byte === SB) { this.state = 'subnegotiation-option'; return; }
    if (byte === 243 || byte === 244) output.push(3); // Break / interrupt key.
    this.state = 'data';
  }

  private consumeOption(option: number, replies: number[][]): void {
    if (this.optionVerb === DO) {
      const state = this.localOptions.get(option);
      if (supportsLocal(option)) {
        if (state !== 'enabled') {
          this.localOptions.set(option, 'enabled');
          if (state !== 'pending') replies.push([IAC, WILL, option]);
          if (option === WINDOW_SIZE) replies.push([...this.windowSizeCommand()]);
        }
      } else if (state !== 'refused') {
        this.localOptions.set(option, 'refused');
        replies.push([IAC, WONT, option]);
      }
    } else if (this.optionVerb === DONT) {
      const state = this.localOptions.get(option);
      if (state === 'enabled' || state === 'pending') replies.push([IAC, WONT, option]);
      this.localOptions.set(option, 'disabled');
    } else if (this.optionVerb === WILL) {
      const state = this.remoteOptions.get(option);
      if (supportsRemote(option)) {
        this.remoteOptions.set(option, 'enabled');
        if (state !== 'pending') replies.push([IAC, DO, option]);
      } else if (state !== 'refused') {
        this.remoteOptions.set(option, 'refused');
        replies.push([IAC, DONT, option]);
      }
    } else if (this.optionVerb === WONT) {
      const state = this.remoteOptions.get(option);
      if (state === 'enabled' || state === 'pending') replies.push([IAC, DONT, option]);
      this.remoteOptions.set(option, 'disabled');
    }
  }

  private completeSubnegotiation(replies: number[][]): void {
    if (this.subnegotiationOverflow || this.subnegotiationOption !== TERMINAL_TYPE ||
        this.localOptions.get(TERMINAL_TYPE) !== 'enabled' || this.subnegotiation[0] !== TERMINAL_TYPE_SEND || this.terminalTypeReported) return;
    this.terminalTypeReported = true;
    replies.push([...subnegotiationCommand(TERMINAL_TYPE, Uint8Array.from([TERMINAL_TYPE_IS, ...TERMINAL_NAME]))]);
  }

  private appendSubnegotiation(byte: number): void {
    if (this.subnegotiation.length >= MAX_SUBNEGOTIATION_BYTES) { this.subnegotiationOverflow = true; return; }
    this.subnegotiation.push(byte);
  }

  private requestLocal(option: number, output: number[]): void {
    if (this.localOptions.has(option)) return;
    this.localOptions.set(option, 'pending');
    output.push(IAC, WILL, option);
  }

  private requestRemote(option: number, output: number[]): void {
    if (this.remoteOptions.has(option)) return;
    this.remoteOptions.set(option, 'pending');
    output.push(IAC, DO, option);
  }

  private windowSizeCommand(): Uint8Array {
    const width = [this.size.columns >>> 8 & 0xff, this.size.columns & 0xff];
    const height = [this.size.rows >>> 8 & 0xff, this.size.rows & 0xff];
    return subnegotiationCommand(WINDOW_SIZE, Uint8Array.from([...width, ...height]));
  }
}

function supportsLocal(option: number): boolean {
  return option === BINARY || option === SUPPRESS_GO_AHEAD || option === TERMINAL_TYPE || option === WINDOW_SIZE;
}

function supportsRemote(option: number): boolean {
  return option === BINARY || option === ECHO || option === SUPPRESS_GO_AHEAD;
}

function subnegotiationCommand(option: number, payload: Uint8Array): Uint8Array {
  const command = [IAC, SB, option];
  for (const byte of payload) {
    command.push(byte);
    if (byte === IAC) command.push(IAC);
  }
  command.push(IAC, SE);
  return Uint8Array.from(command);
}
