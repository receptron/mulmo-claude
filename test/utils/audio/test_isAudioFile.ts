import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAudioFile, isVideoFile } from "../../../src/utils/audio/isAudioFile";

function fakeFile(name: string, type: string): File {
  // Node's File polyfill lets us construct a minimal File without
  // spinning up a blob pipeline. Only name/type/size matter for
  // the gate.
  return new File([new Uint8Array(0)], name, { type });
}

describe("isAudioFile", () => {
  it("accepts audio/* MIME types", () => {
    assert.equal(isAudioFile(fakeFile("clip.mp3", "audio/mpeg")), true);
    assert.equal(isAudioFile(fakeFile("clip.m4a", "audio/mp4")), true);
    assert.equal(isAudioFile(fakeFile("clip.ogg", "audio/ogg")), true);
    assert.equal(isAudioFile(fakeFile("clip.flac", "audio/flac")), true);
    assert.equal(isAudioFile(fakeFile("clip.wav", "audio/wav")), true);
  });

  it("falls back to extension when MIME is missing", () => {
    // macOS often reports `application/octet-stream` for .m4a
    assert.equal(isAudioFile(fakeFile("clip.m4a", "application/octet-stream")), true);
    assert.equal(isAudioFile(fakeFile("clip.opus", "")), true);
    assert.equal(isAudioFile(fakeFile("clip.flac", "")), true);
  });

  it("handles case-insensitive extensions", () => {
    assert.equal(isAudioFile(fakeFile("CLIP.MP3", "")), true);
    assert.equal(isAudioFile(fakeFile("Clip.Wav", "")), true);
  });

  it("rejects non-audio files", () => {
    assert.equal(isAudioFile(fakeFile("photo.jpg", "image/jpeg")), false);
    assert.equal(isAudioFile(fakeFile("doc.pdf", "application/pdf")), false);
    assert.equal(isAudioFile(fakeFile("notes.txt", "text/plain")), false);
  });

  it("rejects files without an extension or audio MIME", () => {
    assert.equal(isAudioFile(fakeFile("noext", "application/octet-stream")), false);
  });
});

describe("isVideoFile", () => {
  it("accepts video/* MIME types", () => {
    assert.equal(isVideoFile(fakeFile("clip.mp4", "video/mp4")), true);
    assert.equal(isVideoFile(fakeFile("clip.webm", "video/webm")), true);
  });

  it("falls back to extension for common video formats", () => {
    assert.equal(isVideoFile(fakeFile("clip.mov", "")), true);
    assert.equal(isVideoFile(fakeFile("clip.mkv", "application/octet-stream")), true);
  });

  it("does not flag audio-only webm as video via extension alone", () => {
    // `.webm` is listed in AUDIO_EXTENSIONS because audio-only webm
    // containers are legitimate. A true video webm will carry
    // `video/webm` MIME and get caught by the type branch.
    assert.equal(isVideoFile(fakeFile("clip.webm", "")), false);
    assert.equal(isVideoFile(fakeFile("clip.webm", "video/webm")), true);
  });
});
