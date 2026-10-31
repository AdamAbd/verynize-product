// Exercise the native email transport: the send-email binding in real local workerd, or on the
// Node runtime the SMTP transport against a real SMTP listener run by this test.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Miniflare, RUNTIME, cloudOptions } from "./cloud-harness.mjs";

/** A minimal SMTP receiver that accepts mail from one sender and records each message. */
async function smtpListener(allowedSender) {
  const messages = [];
  const server = net.createServer((socket) => {
    let buffer = "",
      data = null,
      from = null,
      to = [];
    const reply = (line) => socket.write(line + "\r\n");
    reply("220 localhost ESMTP test");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (data !== null) {
          if (line === ".") {
            // Quoted-printable bodies: join soft line breaks and decode =XX escapes.
            const text = data
              .join("\n")
              .replace(/=\n/g, "")
              .replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
            messages.push({ from, to, data: text });
            data = null;
            reply("250 queued");
          } else data.push(line.startsWith("..") ? line.slice(1) : line);
          continue;
        }
        const command = line.slice(0, 4).toUpperCase();
        if (command === "EHLO" || command === "HELO") reply("250 localhost");
        else if (command === "MAIL") {
          from = /<([^>]*)>/.exec(line)?.[1];
          to = [];
          reply(from === allowedSender ? "250 ok" : "550 sender not allowed");
        } else if (command === "RCPT") {
          to.push(/<([^>]*)>/.exec(line)?.[1]);
          reply("250 ok");
        } else if (command === "DATA") {
          data = [];
          reply("354 end with .");
        } else if (command === "QUIT") {
          reply("221 bye");
          socket.end();
        } else if (command === "RSET") reply("250 ok");
        else reply("502 not implemented");
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { messages, port: server.address().port, close: () => server.close() };
}

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-email-"));
let mf;
try {
  const options = await cloudOptions(path.join(dir, "state"));
  const env = options.workers[0].config.env;
  if (RUNTIME === "node") {
    const smtp = await smtpListener("mada@gayaloo.app");
    try {
      env.EMAIL_PROVIDER = { type: "text", value: "smtp" };
      env.EMAIL_FROM = { type: "text", value: "mada@gayaloo.app" };
      env.SMTP_MAILER = { type: "smtp", host: "127.0.0.1", port: smtp.port };
      mf = new Miniflare(options);
      const start = () =>
        mf.dispatchFetch("https://verynize.gayaloo.app/api/auth/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "recipient@example.com" }),
        });
      let response = await start();
      assert.equal(response.status, 200, await response.text());
      assert.equal(smtp.messages.length, 1);
      assert.deepEqual(smtp.messages[0].to, ["recipient@example.com"]);
      assert.match(smtp.messages[0].data, /Subject: Your Verynize sign-in link/);
      assert.match(smtp.messages[0].data, /https:\/\/verynize\.gayaloo\.app\/#signin=/);
      env.EMAIL_FROM.value = "unauthorized@gayaloo.app";
      await mf.setOptions(options);
      response = await start();
      assert.equal(response.status, 502, await response.text());
      delete env.SMTP_MAILER;
      await mf.setOptions(options);
      response = await start();
      assert.equal(response.status, 503, await response.text());
      assert.equal(smtp.messages.length, 1);
      console.log(
        "cloud email (node): SMTP sending, sender rejection and missing transport passed",
      );
    } finally {
      smtp.close();
    }
  } else {
    env.EMAIL_PROVIDER = { type: "text", value: "cloudflare" };
    env.EMAIL_FROM = { type: "text", value: "mada@gayaloo.app" };
    env.EMAIL = { type: "send-email", allowedSenderAddresses: ["mada@gayaloo.app"] };
    mf = new Miniflare(options);
    const start = () =>
      mf.dispatchFetch("https://verynize.gayaloo.app/api/auth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "recipient@example.com" }),
      });
    let response = await start();
    assert.equal(response.status, 200, await response.text());
    env.EMAIL_FROM.value = "unauthorized@gayaloo.app";
    await mf.setOptions(options);
    response = await start();
    assert.equal(response.status, 502, await response.text());
    delete env.EMAIL;
    await mf.setOptions(options);
    response = await start();
    assert.equal(response.status, 503, await response.text());
    console.log("cloud email: native sending, sender restrictions and missing binding passed");
  }
} finally {
  await mf?.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
