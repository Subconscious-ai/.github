#!/usr/bin/env node

const PROJECT_NUMBER = 6;
const ORG = "Subconscious-ai";

const PROJECT_FIELDS = {
  Priority: {
    id: "PVTSSF_lADOBv4omM4ANisKzgQdiE4",
    options: {
      high: "6564ecd6",
      "high🐆": "6564ecd6",
      med: "cbc02aa8",
      medium: "cbc02aa8",
      "med🐢": "cbc02aa8",
      low: "ef425260",
      "low🐌": "ef425260",
    },
  },
  Size: {
    id: "PVTSSF_lADOBv4omM4ANisKzgIpHKU",
    options: {
      small: "0237b765",
      "small🐜": "0237b765",
      med: "78b753d2",
      medium: "78b753d2",
      "med🐑": "78b753d2",
      large: "c25f58fe",
      "large🐘": "c25f58fe",
    },
  },
  Squad: {
    id: "PVTSSF_lADOBv4omM4ANisKzgM9-Bo",
    options: {
      frontend: "b458dea9",
      "frontend🐱": "b458dea9",
      backend: "8527a473",
      "backend🐺": "8527a473",
      research: "252a80cd",
      "research🦉": "252a80cd",
      growth: "e28f263e",
      "growth🦚": "e28f263e",
    },
  },
};

const BODY_TO_PROJECT_FIELD = [
  { heading: "Roadmap priority", field: "Priority" },
  { heading: "Priority", field: "Priority" },
  { heading: "Size", field: "Size" },
  { heading: "Squad", field: "Squad" },
];

function normalize(value) {
  return value
    .replace(/\r/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function extractSection(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\n)###\\s+${escaped}\\s*\\n+([\\s\\S]*?)(?=\\n###\\s+|$)`,
    "i",
  );
  const match = body.match(pattern);
  return match ? normalize(match[1]) : null;
}

export function parseRoadmapFields(body) {
  const updates = {};

  for (const { heading, field } of BODY_TO_PROJECT_FIELD) {
    if (updates[field]) continue;

    const value = extractSection(body, heading);
    if (!value || value === "_no response_" || value === "none") continue;

    const optionId = PROJECT_FIELDS[field].options[value];
    if (optionId) {
      updates[field] = optionId;
    }
  }

  return updates;
}

async function graphql(query, variables = {}) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GH_TOKEN or GITHUB_TOKEN is required");
  }

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors) {
    throw new Error(JSON.stringify(payload.errors || payload, null, 2));
  }

  return payload.data;
}

async function loadIssue(owner, repo, issueNumber) {
  const data = await graphql(
    `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            id
            body
            url
            projectItems(first: 20) {
              nodes {
                id
                project {
                  id
                }
              }
            }
          }
        }
      }
    `,
    { owner, repo, number: Number(issueNumber) },
  );

  return data.repository.issue;
}

async function loadProject() {
  const data = await graphql(
    `
      query($org: String!, $number: Int!) {
        organization(login: $org) {
          projectV2(number: $number) {
            id
          }
        }
      }
    `,
    { org: ORG, number: PROJECT_NUMBER },
  );

  return data.organization.projectV2;
}

async function addIssueToProject(projectId, issueId) {
  const data = await graphql(
    `
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item {
            id
          }
        }
      }
    `,
    { projectId, contentId: issueId },
  );

  return data.addProjectV2ItemById.item.id;
}

async function updateField(projectId, itemId, fieldName, optionId) {
  await graphql(
    `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { singleSelectOptionId: $optionId }
          }
        ) {
          projectV2Item {
            id
          }
        }
      }
    `,
    {
      projectId,
      itemId,
      fieldId: PROJECT_FIELDS[fieldName].id,
      optionId,
    },
  );
}

function splitRepository(repository) {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error("REPOSITORY must be in owner/repo format");
  }
  return { owner, repo };
}

async function syncRoadmapFields() {
  const repository = process.env.REPOSITORY || process.env.GITHUB_REPOSITORY;
  const issueNumber = process.env.ISSUE_NUMBER;

  if (!repository || !issueNumber) {
    throw new Error("REPOSITORY and ISSUE_NUMBER are required");
  }

  const { owner, repo } = splitRepository(repository);
  const issue = await loadIssue(owner, repo, issueNumber);
  const updates = parseRoadmapFields(issue.body || "");

  if (!Object.keys(updates).length) {
    console.log(`No Roadmap field values found in ${issue.url}`);
    return;
  }

  const project = await loadProject();
  const existingItem = issue.projectItems.nodes.find(
    (item) => item.project.id === project.id,
  );
  const itemId = existingItem
    ? existingItem.id
    : await addIssueToProject(project.id, issue.id);

  for (const [fieldName, optionId] of Object.entries(updates)) {
    await updateField(project.id, itemId, fieldName, optionId);
    console.log(`Synced ${fieldName}`);
  }

  console.log(`Synced ${Object.keys(updates).length} Roadmap field(s) for ${issue.url}`);
}

function selfTest() {
  const body = `
### Job
Do the thing.

### Roadmap priority
High

### Size
Large

### Squad
Frontend
`;

  const parsed = parseRoadmapFields(body);
  const expected = {
    Priority: "6564ecd6",
    Size: "c25f58fe",
    Squad: "b458dea9",
  };

  const ok = JSON.stringify(parsed) === JSON.stringify(expected);
  if (!ok) {
    console.error("Expected:", expected);
    console.error("Received:", parsed);
    process.exit(1);
  }

  console.log("self-test ok: parsed Roadmap priority, size, and squad");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  syncRoadmapFields().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
