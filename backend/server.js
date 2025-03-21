const express = require("express");
const dotenv = require("dotenv");
const { MongoClient, ObjectId } = require("mongodb");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");
dotenv.config();
//encryption is the most wonder full part of the project
// Encryption and Decryption keys
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'utf-8');
const IV_LENGTH = 16; // For AES, this is always 16

// Encrypt a password
const encrypt = (text) => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY),
    iv
  );
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted; // Store IV with the encrypted password
};

const decrypt = (text) => {
  const [iv, encryptedData] = text.split(":");
  const ivBuffer = Buffer.from(iv, "hex");

  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY),
    ivBuffer
  );
  let decrypted = decipher.update(encryptedData, "hex", "utf-8");

  decrypted += decipher.final("utf-8");

  return decrypted;
};

// Connecting to the MongoDB Client
const url = process.env.MONGO_URI;
const client = new MongoClient(url);

client
  .connect()
  .then(() => {
    console.log("Database connected");
  })
  .catch((error) => {
    console.error("Database connection failed:", error);
    process.exit(1); // Exit the process if the database connection fails
  });

// App & Database
const dbName = process.env.DB_NAME;
const app = express();
const port = process.env.PORT || 3000; // Use port from environment variables or default to 3000

// Middleware
app.use(bodyParser.json());
app.use(cors({ origin: 'chrome-extension://your-extension-id' })); // Replace with your actual extension ID

// Get all the passwords
app.get("/", async (req, res) => {
  try {
    const db = client.db(dbName);
    const collection = db.collection("passwords");
    const passwords = await collection.find({}).toArray();
    const decryptedPassword = passwords.map((item) => {
    return { ...item, password: decrypt(item.password) };
    });
    res.status(200).json(decryptedPassword);
  } catch (error) {
    console.error("Error fetching passwords:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// Get a password by id
app.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ID format (optional but recommended)
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid ID format" });
    }

    const db = client.db(dbName);
    const collection = db.collection("passwords");
    
    // Fetch the password item from the database
    const item = await collection.findOne({ _id: new ObjectId(id) });

    // Check if the password exists
    if (!item) {
      return res.status(404).json({ success: false, message: "Password not found" });
    }

    // Split and decrypt the password
    const [iv, encryptedData] = item.password.split(':');
    const decryptedPassword = decrypt({ iv, encryptedData });

    // Return the item with the decrypted password
    res.status(200).json({ ...item, password: decryptedPassword });
  } catch (error) {
    console.error("Error fetching password:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// Save a password
app.post("/", async (req, res) => {
  try {
    const { site, username, password } = req.body;
    if (!site || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "Site, username, and password are required",
      });
    }

    const db = client.db(dbName);
    const collection = db.collection("passwords");
    // Encrypt the password before saving
    const encryptedPassword = encrypt(password);
    const result = await collection.insertOne({
      site,
      username,
      password: encryptedPassword,
    });
    res.status(201).json({ success: true, result });
  } catch (error) {
    console.error("Error saving password:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// Update a password by id
app.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { site, username, password } = req.body;

    if (!site || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "Site, username, and password are required",
      });
    }

    const db = client.db(dbName);
    const collection = db.collection("passwords");

    // Encrypt the new password before updating
    const encryptedPassword = encrypt(password);

    const result = await collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { site, username, password: encryptedPassword } } // Use the encrypted password here
    );

    if (result.matchedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Password not found" });
    }

    res.status(200).json({
      success: true,
      message: "Password updated successfully",
      result,
    });
  } catch (error) {
    console.error("Error updating password:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// Delete a password by id
app.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ success: false, message: "ID is required" });
    }

    const db = client.db(dbName);
    const collection = db.collection("passwords");

    // Step 1: Find the password by ID
    const password = await collection.findOne({ _id: new ObjectId(id) });

    // Step 2: Check if the password exists
    if (!password) {
      return res.status(404).json({ success: false, message: "Password not found" });
    }

    // Step 3: Proceed to delete the password
    const result = await collection.deleteOne({ _id: new ObjectId(id) });

    // Step 4: Confirm deletion
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Password could not be deleted" });
    }

    res.status(200).json({
      success: true,
      message: "Password deleted successfully",
      result,
    });
  } catch (error) {
    console.error("Error deleting password:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// Exporting the passwords
app.get("/export", async (req, res) => {
  try {
    const db = client.db(dbName);
    const passwords = await db.collection("passwords").find({}).toArray();

    // Decrypt each password before exporting
    const decryptedPasswords = passwords.map((password) => ({
      site: password.site,
      username: password.username,
      password: decrypt(password.password), // Directly decrypt the stored password
    }));

    res.setHeader("content-Type", "application/json");
    res.setHeader("content-disposition", "attachment; filename=passwords.json");
    res.status(200).json(decryptedPasswords);
  } catch (error) {
    console.error("Error exporting passwords:", error);
    res
      .status(500)
      .json({ success: false, message: "Error exporting the passwords" });
  }
});

// Importing the passwords
app.post("/import", async (req, res) => {
  try {
    const passwords = req.body;
    const db = client.db(dbName);
    const collection = db.collection("passwords");

    await collection.insertMany(passwords);

    res
      .status(200)
      .json({ success: true, message: "Passwords imported successfully" });
  } catch (error) {
    console.error("Error importing passwords:", error);
    res
      .status(500)
      .json({ success: false, message: "Error importing the passwords" });
  }
});

// Server listen
app.listen(port, () => {
  console.log(`PassOP server listening on http://localhost:${port}`);
});
