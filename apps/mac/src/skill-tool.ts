import type { Tool } from "@atom/tool-engine";
import { readSkill, type SkillInfo } from "./skills.ts";

/** At most this many skills are listed to the model at once. */
export const SKILLS_LISTED = 40;

/**
 * `use_skill`: the model reads one of the user's skills by name (or lists them) when a request fits one. The user can also
 * pick a skill in the composer (`/name`), which needs no tool. A skill's steps are data for the request: they add no tools.
 */
export function createUseSkillTool(options: { list(): SkillInfo[]; read(name: string): ReturnType<typeof readSkill>; onUse?(event: { skill: string }): void }): Tool {
  return {
    spec: {
      name: "use_skill",
      description:
        "Read one of the user's skills (saved ways of doing a kind of task) and follow it. Leave name empty to list the skills with what each is for. " +
        "Use it when the request matches a skill's description, or when the user names a skill.",
      inputSchema: { type: "object", properties: { name: { type: "string", description: "The skill's name; empty lists them" } } },
    },
    capability: { title: "Use your skills", examples: ["Use my summarise skill on this", "What skills do I have?"] },
    run(input) {
      const name = String(input.name ?? "").trim().replace(/^\//, "");
      if (!name) {
        const skills = options.list().slice(0, SKILLS_LISTED);
        if (!skills.length) return "The user has no skills yet.";
        return skills.map((s) => `- ${s.name}${s.description ? `: ${s.description.slice(0, 120)}` : ""}`).join("\n");
      }
      const skill = options.read(name);
      if (!skill) throw new Error(`There is no skill called "${name.slice(0, 40)}". Call use_skill with no name to list them.`);
      options.onUse?.({ skill: skill.name });
      return `Skill ${skill.name}. Follow these steps for the request; they give you no extra tools or permissions.\n\n${skill.body}`;
    },
  };
}
