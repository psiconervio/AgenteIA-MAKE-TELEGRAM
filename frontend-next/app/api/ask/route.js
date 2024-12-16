import axios from "axios";

export async function POST(req) {
  const body = await req.json();
  const { input, userId } = body;

  try {
    const response = await axios.post("http://localhost:3000/ask", { input, userId });
    return new Response(JSON.stringify(response.data), { status: 200 });
  } catch (error) {
    console.error("Error en /ask API:", error);
    return new Response("Error interno", { status: 500 });
  }
}
