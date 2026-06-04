// migrate-r2-trend-library.js
//
// One-time migration script for Trend Boiler R2 library objects.
//
// It copies old sector-level report objects into the new project-specific structure.
//
// Old examples:
//   trendboiler/trend-library/meta/government/report.pdf
//   trendboiler/trend-library/meta/banking/report.pdf
//
// New examples:
//   trendboiler/trend-library/meta/projects/ey-singapore-government-5gpuup/sectors/government/report.pdf
//   trendboiler/trend-library/meta/projects/ey-london-banking-cn5fac/sectors/banking/report.pdf
//
// Install:
//   npm install @aws-sdk/client-s3
//
// Dry run:
//   node migrate-r2-trend-library.js
//
// Copy for real:
//   DRY_RUN=false node migrate-r2-trend-library.js
//
// Optional delete originals after successful copy:
//   DRY_RUN=false DELETE_OLD=true node migrate-r2-trend-library.js

import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand
} from "@aws-sdk/client-s3";

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  DRY_RUN = "true",
  DELETE_OLD = "false"
} = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error(`
Missing required environment variables.

Required:
  R2_ACCOUNT_ID
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET

Example:
  export R2_ACCOUNT_ID="your-cloudflare-account-id"
  export R2_ACCESS_KEY_ID="your-r2-access-key-id"
  export R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
  export R2_BUCKET="your-bucket-name"
`);
  process.exit(1);
}

const dryRun = String(DRY_RUN).toLowerCase() !== "false";
const deleteOld = String(DELETE_OLD).toLowerCase() === "true";

const client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY
  }
});

const ROOT_PREFIX = "trend-library/meta/";

const MIGRATION_MAP = {
  government: {
    projectId: "ey-singapore-government-5gpuup",
    targetSector: "government"
  },
  banking: {
    projectId: "ey-london-banking-cn5fac",
    targetSector: "banking"
  },
  canary: {
    projectId: "legacy-ryi4r3",
    targetSector: "canary"
  },
  logistics: {
    projectId: "legacy-ryi4r3",
    targetSector: "logistics"
  },
  osint: {
    projectId: "legacy-ryi4r3",
    targetSector: "osint"
  },
  retail: {
    projectId: "legacy-ryi4r3",
    targetSector: "retail"
  },
  trade: {
    projectId: "legacy-ryi4r3",
    targetSector: "trade"
  }
};

function targetKeyFor(sourceKey, sector, projectId, targetSector) {
  const sourcePrefix = `${ROOT_PREFIX}${sector}/`;
  const relativePath = sourceKey.slice(sourcePrefix.length);

  return `${ROOT_PREFIX}projects/${projectId}/sectors/${targetSector}/${relativePath}`;
}

function isFolderPlaceholder(key) {
  return key.endsWith("/");
}

function isAlreadyInProjects(key) {
  return key.startsWith(`${ROOT_PREFIX}projects/`);
}

async function objectExists(key) {
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: R2_BUCKET,
        Key: key
      })
    );
    return true;
  } catch {
    return false;
  }
}

async function listObjects(prefix) {
  const objects = [];
  let ContinuationToken;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        ContinuationToken
      })
    );

    for (const item of response.Contents || []) {
      if (!item.Key) continue;
      objects.push(item);
    }

    ContinuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (ContinuationToken);

  return objects;
}

async function copyObject(sourceKey, targetKey) {
  const encodedCopySource = encodeURIComponent(`${R2_BUCKET}/${sourceKey}`);

  await client.send(
    new CopyObjectCommand({
      Bucket: R2_BUCKET,
      CopySource: encodedCopySource,
      Key: targetKey,
      MetadataDirective: "COPY"
    })
  );
}

async function deleteObject(key) {
  await client.send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: key
    })
  );
}

async function migrateSector(sector, config) {
  const sourcePrefix = `${ROOT_PREFIX}${sector}/`;
  const objects = await listObjects(sourcePrefix);

  const files = objects.filter((item) => {
    const key = item.Key;
    if (!key) return false;
    if (isFolderPlaceholder(key)) return false;
    if (isAlreadyInProjects(key)) return false;
    return true;
  });

  console.log(`\nSector: ${sector}`);
  console.log(`Source prefix: ${sourcePrefix}`);
  console.log(`Files found: ${files.length}`);

  if (!files.length) return { copied: 0, skipped: 0, deleted: 0, failed: 0 };

  let copied = 0;
  let skipped = 0;
  let deleted = 0;
  let failed = 0;

  for (const file of files) {
    const sourceKey = file.Key;
    const targetKey = targetKeyFor(
      sourceKey,
      sector,
      config.projectId,
      config.targetSector
    );

    try {
      const exists = await objectExists(targetKey);

      if (exists) {
        console.log(`SKIP EXISTS: ${targetKey}`);
        skipped += 1;
      } else if (dryRun) {
        console.log(`WOULD COPY: ${sourceKey} -> ${targetKey}`);
        copied += 1;
      } else {
        console.log(`COPY: ${sourceKey} -> ${targetKey}`);
        await copyObject(sourceKey, targetKey);
        copied += 1;
      }

      if (deleteOld) {
        if (dryRun) {
          console.log(`WOULD DELETE OLD: ${sourceKey}`);
        } else {
          console.log(`DELETE OLD: ${sourceKey}`);
          await deleteObject(sourceKey);
          deleted += 1;
        }
      }
    } catch (error) {
      failed += 1;
      console.error(`FAILED: ${sourceKey}`);
      console.error(error?.message || error);
    }
  }

  return { copied, skipped, deleted, failed };
}

async function main() {
  console.log("Trend Boiler R2 migration");
  console.log(`Bucket: ${R2_BUCKET}`);
  console.log(`Root prefix: ${ROOT_PREFIX}`);
  console.log(`Dry run: ${dryRun}`);
  console.log(`Delete old after copy: ${deleteOld}`);

  if (deleteOld && dryRun) {
    console.log("Note: DELETE_OLD=true is ignored during dry run.");
  }

  const totals = {
    copied: 0,
    skipped: 0,
    deleted: 0,
    failed: 0
  };

  for (const [sector, config] of Object.entries(MIGRATION_MAP)) {
    const result = await migrateSector(sector, config);

    totals.copied += result.copied;
    totals.skipped += result.skipped;
    totals.deleted += result.deleted;
    totals.failed += result.failed;
  }

  console.log("\nMigration summary");
  console.log(`Copied / would copy: ${totals.copied}`);
  console.log(`Skipped existing: ${totals.skipped}`);
  console.log(`Deleted old: ${totals.deleted}`);
  console.log(`Failed: ${totals.failed}`);

  if (dryRun) {
    console.log("\nDry run only. No files were changed.");
    console.log("To copy for real, run:");
    console.log("  DRY_RUN=false node migrate-r2-trend-library.js");
  } else if (!deleteOld) {
    console.log("\nCopied files and left originals in place.");
    console.log("After confirming the app can see the new project files, optionally delete originals with:");
    console.log("  DRY_RUN=false DELETE_OLD=true node migrate-r2-trend-library.js");
  } else {
    console.log("\nCopied files and deleted originals.");
  }
}

main().catch((error) => {
  console.error("Migration failed");
  console.error(error?.message || error);
  process.exit(1);
});