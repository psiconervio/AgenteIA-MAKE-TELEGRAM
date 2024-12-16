import axios from "axios";
import FormData from "form-data";

export async function POST(req) {
  const data = await req.formData();
  const audio = data.get("audio");

  const formData = new FormData();
  formData.append("audio", audio);

  try {
    const response = await axios.post("http://localhost:3000/audio", formData, {
      headers: formData.getHeaders(),
    });
    return new Response(JSON.stringify(response.data), { status: 200 });
  } catch (error) {
    console.error("Error en /audio API:", error);
    return new Response("Error interno", { status: 500 });
  }
}
