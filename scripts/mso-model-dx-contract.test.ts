import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const cli = fs.readFileSync(path.join(root, "bin/mso"), "utf8");
const agentCli = fs.readFileSync(path.join(__dirname, "mso-cli-agent.sh"), "utf8");
const configRoute = fs.readFileSync(path.join(root, "app/api/config/route.ts"), "utf8");
const oauthRoute = fs.readFileSync(path.join(root, "app/api/oauth/[provider]/route.ts"), "utf8");
const slash = fs.readFileSync(path.join(__dirname, "mso-agent-slash.mjs"), "utf8");
const picker = fs.readFileSync(path.join(__dirname, "mso-tui-select.mjs"), "utf8");

const all = [cli, agentCli, configRoute, oauthRoute, slash, picker].join("\n");

describe("MSO model/provider/session CLI contract", () => {
  it("keeps provider auth (`models`) separate from active selection (`model`)", () => {
    expect(cli).toContain('VERSION="1.5.6"');
    expect(cli).toContain("models *             Configure AI providers/auth");
    expect(cli).toContain("model [ref]          Select active model");
    expect(agentCli).toContain("run_models()");
    expect(agentCli).toContain("run_model_setup()");
    expect(agentCli).toContain("provider_key_body_unselected");
    expect(agentCli).toContain("custom_provider_body_unselected");
    expect(all).toContain("select:false");
    expect(configRoute).toContain("body.select !== false");
    expect(oauthRoute).toContain("body.select !== false");
    expect(slash).toContain('text: "/models", meta: "Configure AI providers and authentication"');
    expect(slash).toContain('text: "/model", meta: "Select the active model from connected providers"');
  });


  it("uses one native arrow-key picker instead of numeric provider/model prompts", () => {
    expect(agentCli).toContain('tui_select "Select AI provider"');
    expect(agentCli).toContain('tui_select "Select model · $provider"');
    expect(agentCli).toContain('tui_select "AI provider/auth manager"');
    expect(agentCli).not.toContain('Provider [1]:');
    expect(agentCli).not.toContain('Model [1]:');
    expect(agentCli).not.toContain('choose a provider number');
    expect(agentCli).not.toContain('choose a model number');
    expect(picker).toContain("↑↓ navigate · type filter · Enter select · Esc cancel");
    expect(picker).toContain("nextPickerIndex");
  });

  it("supports explicit and slash-containing model IDs without losing provider intent", () => {
    expect(agentCli).toContain("Model IDs themselves may contain slashes");
    expect(agentCli).toContain("mso model set <provider> <model>");
    expect(agentCli).toContain("any(.models[]?; .id==$id)");
    expect(agentCli).toContain('select_model_ref "$2/$3"');
  });

  it("makes durable session continuation a first-class CLI startup path", () => {
    expect(cli).toContain("--continue|-c");
    expect(cli).toContain("--resume|-r");
    expect(cli).toContain('AGENT_START_ARGS+=("--continue")');
    expect(cli).toContain('AGENT_START_ARGS+=("--resume" "$2")');
    expect(slash).toContain('text: "/resume"');
    expect(slash).toContain('text: "/status"');
  });
});
