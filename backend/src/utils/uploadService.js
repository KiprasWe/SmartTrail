import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "../config/r2.js";
import crypto from "crypto";
import path from "path";

const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;

export const uploadProfilePicture = async (file) => {
  const ext = path.extname(file.originalname);
  const key = `profile-pictures/${crypto.randomUUID()}${ext}`;

  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    }),
  );

  return { key, url: `${PUBLIC_URL}/${key}` };
};

export const deleteFile = async (url) => {
  const key = url.replace(`${PUBLIC_URL}/`, "");

  await r2.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  );
};
