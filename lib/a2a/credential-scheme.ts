import type {
  A2AAgentCard,
  A2ACredentialKind,
  A2AOutboundCredentialSummary,
} from "./types";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requirementSchemeSets(card: A2AAgentCard): string[][] {
  return card.securityRequirements.map((requirement) =>
    Object.keys(object(object(requirement).schemes)),
  );
}

export type A2ACredentialBindingInput = {
  kind: A2ACredentialKind;
  schemeName?: string;
  headerName?: string;
};

export type A2ACredentialBinding = {
  schemeName?: string;
  headerName?: string;
};

export function resolveA2ACredentialBinding(
  card: A2AAgentCard,
  input: A2ACredentialBindingInput,
): A2ACredentialBinding {
  const requirements = requirementSchemeSets(card).filter(
    (set) => set.length > 0,
  );
  const alternatives = requirements.filter((set) => set.length === 1);
  if (!alternatives.length && requirements.some((set) => set.length > 1)) {
    throw new Error(
      `A2A agent ${card.name} requires multiple simultaneous security schemes; one credential profile cannot satisfy that requirement`,
    );
  }

  const allowed = [...new Set(alternatives.flat())];
  const requested = input.schemeName?.trim() || undefined;
  const inferred =
    requested ||
    (allowed.length === 1 ? allowed[0] : undefined) ||
    (card.securitySchemeNames.length === 1
      ? card.securitySchemeNames[0]
      : undefined);

  if (!inferred && card.securitySchemeNames.length > 1) {
    throw new Error(
      `A2A agent ${card.name} offers multiple authentication alternatives; select a security scheme on the credential profile`,
    );
  }
  if (inferred && allowed.length && !allowed.includes(inferred)) {
    throw new Error(
      `A2A credential scheme ${inferred} does not satisfy ${card.name}; allowed alternatives: ${allowed.join(", ")}`,
    );
  }
  if (
    inferred &&
    card.securitySchemeNames.length &&
    !card.securitySchemeNames.includes(inferred)
  ) {
    throw new Error(
      `A2A Agent Card does not declare security scheme ${inferred}`,
    );
  }

  const scheme = inferred ? card.securitySchemes?.[inferred] : undefined;
  if (!scheme) {
    return {
      ...(inferred ? { schemeName: inferred } : {}),
      ...(input.headerName ? { headerName: input.headerName } : {}),
    };
  }

  if (scheme.kind === "api-key") {
    if (scheme.location !== "header") {
      throw new Error(
        `A2A security scheme ${inferred} uses API-key location ${scheme.location}; MSO 1.8 supports header API keys only`,
      );
    }
    if (input.kind !== "api-key") {
      throw new Error(
        `A2A security scheme ${inferred} requires an api-key credential profile`,
      );
    }
    if (
      input.headerName &&
      input.headerName.toLowerCase() !== scheme.name.toLowerCase()
    ) {
      throw new Error(
        `A2A credential header ${input.headerName} does not match Agent Card header ${scheme.name}`,
      );
    }
    return { schemeName: inferred, headerName: scheme.name };
  }
  if (scheme.kind === "http") {
    if (scheme.scheme.toLowerCase() !== "bearer") {
      throw new Error(
        `A2A HTTP auth scheme ${scheme.scheme} is not supported by this credential profile implementation`,
      );
    }
    if (input.kind !== "bearer") {
      throw new Error(
        `A2A security scheme ${inferred} requires a bearer credential profile`,
      );
    }
    return { schemeName: inferred };
  }
  if (scheme.kind === "oauth2" || scheme.kind === "openid") {
    if (input.kind !== "oauth2") {
      throw new Error(
        `A2A security scheme ${inferred} requires an oauth2 access-token profile`,
      );
    }
    return { schemeName: inferred };
  }
  if (scheme.kind === "mtls") {
    throw new Error(
      `A2A mTLS security scheme ${inferred} is not supported by MSO 1.8 credential profiles`,
    );
  }
  throw new Error(
    `A2A security scheme ${inferred} is not a supported v1 authentication scheme`,
  );
}

export function validateStoredA2ACredentialBinding(
  card: A2AAgentCard,
  profile: A2AOutboundCredentialSummary,
): A2ACredentialBinding {
  return resolveA2ACredentialBinding(card, {
    kind: profile.kind,
    schemeName: profile.schemeName,
    headerName: profile.headerName,
  });
}
