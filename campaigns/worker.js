import fs from "fs";
import path from "path";
import csv from "csv-parser";

const API_URL = "http://127.0.0.1:3000/api/send-message";
const API_KEY = "8y+ctt0MgC9IWLF3NiY2pJbKPCzKz/0wjf+cZe+PiQP9sKEb4cJtG7bDJpkvyA+u";

// Load campaign config
const campaign = JSON.parse(
  fs.readFileSync("./campaigns/campaign.json", "utf-8")
);

// Safe sleep function
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ensure delay defaults
const delayMin = campaign.delayMin || 5000;
const delayMax = campaign.delayMax || 8000;

// Read contacts
const contacts = [];

fs.createReadStream("./campaigns/contacts.csv")
  .pipe(csv())
  .on("data", (row) => {
    contacts.push(row);
  })
  .on("end", async () => {
    console.log(`Loaded ${contacts.length} contacts`);

    const report = {
      campaign: campaign.name,
      time: new Date().toISOString(),
      total: contacts.length,
      success: 0,
      failed: 0,
      results: [],
    };

    for (const c of contacts) {
      const number = (c.number || "").toString().trim();
      const name = (c.name || "friend").toString().trim();

      const message = campaign.message.replace("{name}", name);

      console.log(`Sending to ${number}...`);

      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": API_KEY,
          },
          body: JSON.stringify({
            to: number,
            message,
          }),
        });

        const data = await res.json();

        console.log("Response:", data);

        if (data.success) {
          report.success++;
          report.results.push({
            number,
            status: "sent",
            waMessageId: data.data?.waMessageId || null,
          });

          console.log(`✅ Sent to ${number}`);
        } else {
          report.failed++;
          report.results.push({
            number,
            status: "failed",
            error: data.error || "Unknown error",
          });

          console.log(`❌ Failed ${number}: ${data.error}`);
        }
      } catch (err) {
        console.log(`⚠️ Request failed for ${number}:`, err.message);

        report.failed++;
        report.results.push({
          number,
          status: "failed",
          error: err.message,
        });
      }

      // Safe anti-spam delay
      const delay =
        Math.floor(Math.random() * (delayMax - delayMin)) + delayMin;

      console.log(`Waiting ${delay}ms...\n`);
      await sleep(delay);
    }

    // Save report
    const fileName = `campaign-${Date.now()}.json`;

    fs.writeFileSync(
      path.join("./campaigns", fileName),
      JSON.stringify(report, null, 2)
    );

    console.log("\n========== CAMPAIGN FINISHED ==========");
    console.log("Report file:", fileName);
    console.log("Total:", report.total);
    console.log("Success:", report.success);
    console.log("Failed:", report.failed);
  })
  .on("error", (err) => {
    console.error("Error reading CSV:", err);
  });
