import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import aiRoute from "./routes/generate.js";

dotenv.config();
const app = express();

app.use(cors()); // allow frontend requests
app.use(express.json());

// Use AI routes
app.use("/api", aiRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});