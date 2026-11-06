import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { Tool } from "@ark/tool-engine";
import { estimateUsd, makeVideo, type MakeVideoInput, type StudioVideoDeps } from "./studio-video.ts";
import { status as youtubeStatus, upload, type UploadInput, type YouTubeDeps } from "./studio-youtube.ts";

/**
 * Studio (ADR-267, 2026-11-06, Keshab: "ARK does the research, creates the video and posts it"; phase 1: AI footage + YouTube).
 * Two tools for the main agent, each behind ARK's Allow card:
 * - `studio_make_video`: a script and scene prompts become a vertical MP4 (Gemini Omni Flash footage, ARK's voice, ffmpeg). It costs money, so
 *   the card shows the estimate first; nothing is spent on No.
 * - `studio_publish_youtube`: uploads a video ARK made (only files in the Studio folder) to the signed-in channel. Posting is public
 *   and cannot be taken back by ARK, so the card shows the title, description and privacy; nothing is sent on No.
 * Keys come from .env (ARK_STUDIO_GEMINI_KEY, ARK_YOUTUBE_CLIENT_ID/SECRET), never from a chat, and are never logged.
 */

export const MAKE_VIDEO_TOOL = "studio_make_video";
export const PUBLISH_YOUTUBE_TOOL = "studio_publish_youtube";

export interface StudioToolDeps {
  /** The Studio folder: every video ARK makes is written here, and only files here can be posted. */
  outDir: string;
  /** Video deps without the output folder (the folder above is used). Nil when no Gemini key is set. */
  video?: Omit<StudioVideoDeps, "outDir">;
  /** YouTube deps; nil when no client is configured. */
  youtube?: Omit<YouTubeDeps, "openUrl">;
  approve(request: { summary: string; reason: string; reasonMax?: number }, signal?: AbortSignal): Promise<boolean>;
  log?(event: string, fields: Record<string, unknown>): void;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A file is postable only when it is an existing .mp4 inside the Studio folder (no other file on the Mac is ever uploaded). */
export function studioFile(outDir: string, raw: string): string {
  const path = resolve(isAbsolute(raw) ? raw : resolve(outDir, raw));
  const inside = (folder: string, file: string) => {
    const rel = relative(folder, file);
    return Boolean(rel) && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  if (!inside(resolve(outDir), path)) throw new Error("Only videos ARK made in its Studio folder can be posted.");
  if (!path.toLowerCase().endsWith(".mp4") || !existsSync(path)) throw new Error(`${raw} is not a video in the Studio folder.`);
  // A link inside the folder could point at any file on the Mac: only a real file, really inside, is posted (security review).
  if (lstatSync(path).isSymbolicLink() || !statSync(path).isFile() || !inside(realpathSync(outDir), realpathSync(path))) {
    throw new Error("Only videos ARK made in its Studio folder can be posted.");
  }
  return path;
}

/** Card text without invisible or direction-changing characters, so it shows what will really be posted. */
const visible = (value: string) => value.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "");

function makeInput(input: Record<string, unknown>): MakeVideoInput {
  const scenes = Array.isArray(input.scenes) ? input.scenes.map((s) => ({ prompt: text(typeof s === "string" ? s : (s as { prompt?: unknown })?.prompt) })) : [];
  // 720p by default: 360p looks soft on a 1080x1920 Short.
  const quality = input.quality === "lite" || input.quality === "standard" ? input.quality : "fast";
  return {
    title: text(input.title),
    script: text(input.script),
    scenes,
    quality,
    ...(typeof input.seconds_per_scene === "number" ? { secondsPerScene: input.seconds_per_scene } : {}),
  };
}

export function createStudioTools(deps: StudioToolDeps): Tool[] {
  const makeTool: Tool = {
    spec: {
      name: MAKE_VIDEO_TOOL,
      description:
        "Make a vertical short video (9:16, up to 60 s) from a script: AI footage for each scene, ARK's voice reading the script, cut together. " +
        "It costs money (the user sees the estimate and allows it first). Write the script yourself (or from an agent's research) and give " +
        "1 to 6 scene prompts that describe what each clip shows, with no on-screen text. Returns the video's file path for studio_publish_youtube.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "The video's working title." },
          script: { type: "string", description: "What the voice says, start to end (about 2.5 words a second)." },
          scenes: { type: "array", description: "1 to 6 visual prompts (strings), one per clip, in order." },
          seconds_per_scene: { type: "number", description: "Length of each clip in seconds (optional)." },
          quality: { type: "string", description: "fast (720p, default), lite (360p, cheapest) or standard (1080p): footage quality and price." },
        },
        required: ["title", "script", "scenes"],
      },
    },
    capability: { title: "Make a short video", examples: ["Make a 30-second video about today's AI news", "Turn this script into a YouTube Short"] },
    async run(input, signal) {
      if (!deps.video) throw new Error("Studio needs a Gemini API key: add ARK_STUDIO_GEMINI_KEY to ARK's .env, then restart ARK.");
      const request = makeInput(input);
      const model = deps.video.model ?? "gemini-omni-1.2-flash";
      const usd = estimateUsd(request, model);
      const cap = deps.video.maxUsd ?? 5;
      if (usd > cap) throw new Error(`This video would cost about $${usd.toFixed(2)}, above the $${cap.toFixed(2)} limit. Use fewer or shorter scenes, or lower quality.`);
      const allowed = await deps.approve({
        summary: `Make a video: ${request.title.slice(0, 80)}`,
        reason: `${request.scenes.length} AI clip${request.scenes.length === 1 ? "" : "s"} (${request.quality} quality) with ARK's voice. ` +
          `Estimated cost: about $${usd.toFixed(2)}, charged to your Gemini account. Nothing is posted.`,
        reasonMax: 400,
      }, signal);
      if (!allowed) return "The user did not allow making this video. Nothing was spent.";
      const result = await makeVideo(request, { ...deps.video, outDir: deps.outDir }, signal);
      deps.log?.("studio.video", { clips: result.clips, ms: result.durationMs, usd: result.estimatedUsd });
      return `Made the video: ${result.file} (${Math.round(result.durationMs / 1000)} s, ${result.clips} clips, about $${result.estimatedUsd.toFixed(2)}). ` +
        `Captions: ${result.srt}. To post it, call ${PUBLISH_YOUTUBE_TOOL} with this file.`;
    },
  };

  const publishTool: Tool = {
    spec: {
      name: PUBLISH_YOUTUBE_TOOL,
      description:
        "Post a video ARK made (a file from studio_make_video) to the user's YouTube channel as a Short. The user sees the title, description " +
        "and privacy and allows it first. A YouTube app that Google has not verified uploads as private; say so if the result is private.",
      inputSchema: {
        type: "object",
        properties: {
          file: { type: "string", description: "The video's path, as studio_make_video returned it." },
          title: { type: "string", description: "Up to 100 characters." },
          description: { type: "string", description: "Up to 5000 characters." },
          tags: { type: "array", description: "Optional tags (strings)." },
          privacy: { type: "string", description: "public (default), unlisted or private." },
        },
        required: ["file", "title", "description"],
      },
    },
    capability: { title: "Post a video to YouTube", examples: ["Post that video to my channel", "Upload it as a Short"] },
    async run(input, signal) {
      if (!deps.youtube) throw new Error("YouTube is not set up: add ARK_YOUTUBE_CLIENT_ID and ARK_YOUTUBE_CLIENT_SECRET to ARK's .env, then sign in from Plugins > Studio.");
      const file = studioFile(deps.outDir, text(input.file));
      const privacy = input.privacy === "unlisted" || input.privacy === "private" ? input.privacy : "public";
      const request: UploadInput = {
        file, title: text(input.title), description: text(input.description), privacy, short: true,
        ...(Array.isArray(input.tags) ? { tags: input.tags.map(text).filter(Boolean) } : {}),
      };
      const account = await youtubeStatus(deps.youtube);
      if (!account.connected) throw new Error("Sign in to YouTube first, in Plugins > Studio.");
      // The card shows everything that goes public: the whole title (YouTube's limit is 100), the tags, the file and the description.
      const title = visible(request.title), description = visible(request.description);
      const allowed = await deps.approve({
        summary: `Post to YouTube: ${title}`,
        reason: `${privacy[0]!.toUpperCase()}${privacy.slice(1)} Short on ${visible(account.channel)} (#Shorts is added). File: ${basename(file)}. ` +
          `${request.tags?.length ? `Tags: ${visible(request.tags.join(", ")).slice(0, 200)}. ` : ""}` +
          `Description (${description.length} characters): ${description.slice(0, 900)}${description.length > 900 ? " … (more not shown)" : ""}`,
        reasonMax: 1400,
      }, signal);
      if (!allowed) return "The user did not allow posting. Nothing was uploaded.";
      const result = await upload(request, deps.youtube, signal);
      deps.log?.("studio.youtube.posted", { privacy: result.privacy });
      return `Posted to YouTube: ${result.url} (${result.privacy}).${result.privacy !== privacy ? " YouTube kept it private: an app Google has not verified can only upload private videos. Make it public in YouTube Studio." : ""}`;
    },
  };

  return [makeTool, publishTool];
}
