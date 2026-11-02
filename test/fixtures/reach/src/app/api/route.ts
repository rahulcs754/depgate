import axios from "axios";
export async function GET() {
  return Response.json((await axios.get("https://example.com")).data);
}
