require("dotenv").config();
const express = require("express");
const axios = require("axios");
const multer = require("multer");
const cors = require("cors"); // Importar cors
const { PrismaClient } = require("@prisma/client");
const { HfInference } = require("@huggingface/inference");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

// Inicializar dependencias
const app = express();
const prisma = new PrismaClient();
const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

app.use(cors()); // Habilitar CORS para todas las solicitudes
app.use(express.json());
const upload = multer({ dest: "uploads/" });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
const TEXT_TO_SPEECH_API_KEY = process.env.TEXT_TO_SPEECH_API_KEY;

// Resolver preguntas con Hugging Face
async function classifyWithHuggingFace(input) {
  const response = await hf.textClassification({
    model: "distilbert-base-uncased-finetuned-sst-2-english",
    inputs: input,
  });
  return { label: response[0].label, score: response[0].score, model: "Hugging Face - distilbert-finetuned-sst-2" };
}

// Resolver preguntas con ChatGPT
async function respondWithChatGPT(question, history = []) {
  const chatResponse = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4",
      messages: history.concat([{ role: "user", content: question }]),
    },
    {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    }
  );
  return { answer: chatResponse.data.choices[0].message.content, model: "ChatGPT (GPT-3.5)" };
}

// Convertir texto a audio
async function textToSpeech(text) {
  const response = await axios.post(
    "https://api.elevenlabs.io/v1/text-to-speech/W5JElH3dK1UYYAiHH7uh",
    {
      text,
      voice_settings: {
        stability: 0.75,
        similarity_boost: 0.85,
      },
    },
    {
      headers: {
        "xi-api-key": TEXT_TO_SPEECH_API_KEY,
        "Content-Type": "application/json",
      },
      responseType: "arraybuffer",
    }
  );
  const filePath = `uploads/audio-${uuidv4()}.mp3`;
  fs.writeFileSync(filePath, response.data);
  return filePath;
}

// Convertir audio a texto
async function transcribeAudio(filePath) {
  const transcription = await hf.audioToText({
    model: "facebook/wav2vec2-large-960h",
    file: fs.createReadStream(filePath),
  });
  return transcription.text;
}

// Guardar interacción en la base de datos
// async function saveInteraction(question, answer, model) {
//   await prisma.interaction.create({
//     data: {
//       question,
//       answer: `${answer} (Respondido con: ${model})`,
//     },
//   });
// }
async function saveInteraction(question, answer, model, userId) {
  if (!userId) {
    throw new Error("El campo userId es obligatorio para guardar una interacción.");
  }

  await prisma.interaction.create({
    data: {
      question,
      answer: `${answer} (Respondido con: ${model})`,
      userId, // Agregar el userId aquí
    },
  });
}

// Procesar solicitud según palabras clave
async function processRequest(input, history = [], useVoice = false) {
  let response;
  let modelUsed;

  if (input.toLowerCase().includes("-gpt")) {
    const chatResult = await respondWithChatGPT(input, history);
    response = chatResult.answer;
    modelUsed = chatResult.model;
  } else if (input.trim().toLowerCase() === "hola") {
    response = "Hola, ¿cómo puedo ayudarte?";
    modelUsed = "Mensaje Predeterminado";
  } else {
    const hfResult = await classifyWithHuggingFace(input);
    response = `Clasificación: ${hfResult.label} (Confianza: ${hfResult.score})`;
    modelUsed = hfResult.model;
  }

  // Generar audio si se usa el comando "-voz"
  let audioFilePath = null;
  if (useVoice) {
    audioFilePath = await textToSpeech(response);
  }

  return { response, modelUsed, audioFilePath };
}

// Endpoint principal
// app.post("/ask", async (req, res) => {
//   const { input, userId } = req.body;

//   if (!input || input.trim() === "") {
//     res.status(400).json({ error: "La entrada no puede estar vacía." });
//     return;
//   }

//   try {
//     const useVoice = input.startsWith("-voz");
//     const processedInput = useVoice ? input.replace("-voz", "").trim() : input;

//     // Recuperar historial previo del usuario
//     const history = await prisma.interaction.findMany({
//       where: { userId },
//       orderBy: { createdAt: "asc" },
//       select: { question: true, answer: true },
//     });

//     const formattedHistory = history.map((entry) => [
//       { role: "user", content: entry.question },
//       { role: "assistant", content: entry.answer },
//     ]).flat();

//     // Procesar la solicitud
//     const result = await processRequest(processedInput, formattedHistory, useVoice);

//     // Guardar interacción en la base de datos
//     await saveInteraction(input, result.response, result.modelUsed);

//     // Responder al cliente
//     res.json({
//       answer: `${result.response} (Respondido con: ${result.modelUsed})`,
//       audio: result.audioFilePath,
//     });
//   } catch (error) {
//     console.error("Error procesando la pregunta:", error);
//     res.status(500).send("Error procesando la pregunta.");
//   }
// });
// Endpoint principal
app.post("/ask", async (req, res) => {
  const { input, userId } = req.body;

  if (!input || input.trim() === "") {
    res.status(400).json({ error: "La entrada no puede estar vacía." });
    return;
  }

  if (!userId) {
    res.status(400).json({ error: "El campo userId es obligatorio." });
    return;
  }

  try {
    const useVoice = input.startsWith("-voz");
    const processedInput = useVoice ? input.replace("-voz", "").trim() : input;

    // Recuperar historial previo del usuario
    const history = await prisma.interaction.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { question: true, answer: true },
    });

    const formattedHistory = history.map((entry) => [
      { role: "user", content: entry.question },
      { role: "assistant", content: entry.answer },
    ]).flat();

    // Procesar la solicitud
    const result = await processRequest(processedInput, formattedHistory, useVoice);

    // Guardar interacción en la base de datos
    await saveInteraction(input, result.response, result.modelUsed, userId);

    // Responder al cliente
    res.json({
      answer: `${result.response} (Respondido con: ${result.modelUsed})`,
      audio: result.audioFilePath,
    });
  } catch (error) {
    console.error("Error procesando la pregunta:", error);
    res.status(500).send("Error procesando la pregunta.");
  }
});

// Endpoint para subir audio
app.post("/audio", upload.single("audio"), async (req, res) => {
  try {
    const filePath = req.file.path;

    // Transcribir audio
    const transcription = await transcribeAudio(filePath);

    // Procesar la solicitud transcrita
    const result = await processRequest(transcription, [], true);

    // Responder al cliente
    res.json({
      transcription,
      answer: `${result.response} (Respondido con: ${result.modelUsed})`,
      audio: result.audioFilePath,
    });
  } catch (error) {
    console.error("Error procesando el audio:", error);
    res.status(500).send("Error procesando el audio.");
  }
});

// Iniciar el servidor
app.listen(3001, () => {
  console.log("Agente de IA ejecutándose en http://localhost:3000");
});

// require("dotenv").config();
// const express = require("express");
// const axios = require("axios");
// const multer = require("multer");
// const cors = require("cors"); // Importar cors
// const { PrismaClient } = require("@prisma/client");
// const { HfInference } = require("@huggingface/inference");
// const fs = require("fs");
// const { v4: uuidv4 } = require("uuid");

// // Inicializar dependencias
// const app = express();
// const prisma = new PrismaClient();
// const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// app.use(cors()); // Habilitar CORS para todas las solicitudes
// app.use(express.json());
// const upload = multer({ dest: "uploads/" });

// const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
// const TEXT_TO_SPEECH_API_KEY = process.env.TEXT_TO_SPEECH_API_KEY;

// // Resolver preguntas con Hugging Face
// async function classifyWithHuggingFace(input) {
//   const response = await hf.textClassification({
//     model: "distilbert-base-uncased-finetuned-sst-2-english",
//     inputs: input,
//   });
//   return { label: response[0].label, score: response[0].score, model: "Hugging Face - distilbert-finetuned-sst-2" };
// }

// // Resolver preguntas con ChatGPT
// async function respondWithChatGPT(question, history = []) {
//   const chatResponse = await axios.post(
//     "https://api.openai.com/v1/chat/completions",
//     {
//       model: "gpt-3.5",
//       messages: history.concat([{ role: "user", content: question }]),
//     },
//     {
//       headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
//     }
//   );
//   return { answer: chatResponse.data.choices[0].message.content, model: "ChatGPT (GPT-3.5)" };
// }

// // Convertir texto a audio
// async function textToSpeech(text) {
//   const response = await axios.post(
//     "https://api.elevenlabs.io/v1/text-to-speech/W5JElH3dK1UYYAiHH7uh",
//     { text },
//     {
//       headers: {
//         "xi-api-key": TEXT_TO_SPEECH_API_KEY,
//         "Content-Type": "application/json",
//       },
//       responseType: "arraybuffer",
//     }
//   );
//   const filePath = `uploads/audio-${uuidv4()}.mp3`;
//   fs.writeFileSync(filePath, response.data);
//   return filePath;
// }

// // Guardar interacción en la base de datos
// async function saveInteraction(question, answer, model) {
//   await prisma.interaction.create({
//     data: {
//       question,
//       answer: `${answer} (Respondido con: ${model})`,
//     },
//   });
// }

// // Recuperar interacciones previas relacionadas
// async function retrievePreviousInteractions(question) {
//   return await prisma.interaction.findMany({
//     where: {
//       question: { contains: question },
//     },
//     orderBy: { createdAt: "desc" },
//   });
// }

// // Procesar solicitud según palabras clave
// async function processRequest(input, history = []) {
//   if (input.toLowerCase().includes("gpt")) {
//     return await respondWithChatGPT(input, history);
//   } else if (input.toLowerCase().includes("accion")) {
//     return { action: true };
//   } else if (input.trim().toLowerCase() === "hola") {
//     return { answer: "Hola, ¿cómo puedo ayudarte?", model: "Mensaje Predeterminado" };
//   } else {
//     return await classifyWithHuggingFace(input);
//   }
// }

// // Endpoint para borrar todas las interacciones
// app.delete("/interactions", async (req, res) => {
//   try {
//     await prisma.interaction.deleteMany({});
//     res.json({ message: "Todas las interacciones han sido eliminadas." });
//   } catch (error) {
//     console.error("Error borrando interacciones:", error);
//     res.status(500).send("Error al borrar las interacciones.");
//   }
// });

// // Endpoint principal
// app.post("/ask", async (req, res) => {
//   const { input, userId } = req.body;

//   if (!input || input.trim() === "") {
//     res.status(400).json({ error: "La entrada no puede estar vacía." });
//     return;
//   }

//   try {
//     let response;
//     let modelUsed;
//     let audioFilePath;

//     // Recuperar historial previo del usuario
//     // const history = await prisma.interaction.findMany({
//     //   where: { userId },
//     //   orderBy: { createdAt: "asc" },
//     //   select: { question: true, answer: true },
//     // });
//     const history = await prisma.interaction.findMany({
//       orderBy: { createdAt: "asc" }, // Elimina la dependencia del campo userId
//       select: { question: true, answer: true },
//     });

//     const formattedHistory = history.map((entry) => [
//       { role: "user", content: entry.question },
//       { role: "assistant", content: entry.answer },
//     ]).flat();

//     // Procesar la solicitud según el contenido del parámetro "input"
//     const result = await processRequest(input, formattedHistory);

//     if (result.action) {
//       // Si es una acción, activa Make webhook
//       await axios.post(MAKE_WEBHOOK_URL, {
//         accion: "realizar_accion",
//         details: {
//           input,
//           message: "Acción activada mediante palabra clave.",
//         },
//       });
//       res.json({ message: "Acción enviada a Make." });
//       return;
//     } else if (result.label) {
//       // Respuesta de clasificación
//       response = `Clasificación: ${result.label} (Confianza: ${result.score})`;
//       modelUsed = result.model;
//     } else {
//       response = result.answer;
//       modelUsed = result.model;
//     }

//     // Generar audio si es necesario
//     audioFilePath = await textToSpeech(response);

//     // Guardar respuesta en la base de datos
//     await prisma.interaction.create({
//       data: {
//         question: input,
//         answer: response,
//         userId,
//       },
//     });

//     // Responder al cliente
//     res.json({
//       answer: `${response} (Respondido con: ${modelUsed})`,
//       audio: audioFilePath,
//     });
//   } catch (error) {
//     console.error("Error procesando la pregunta:", error);
//     res.status(500).send("Error procesando la pregunta");
//   }
// });

// // Endpoint para subir audio
// app.post("/audio", upload.single("audio"), async (req, res) => {
//   try {
//     const filePath = req.file.path;
//     const transcription = await hf.audioToText({
//       model: "facebook/wav2vec2-large-960h",
//       file: fs.createReadStream(filePath),
//     });
//     res.json({ transcription });
//   } catch (error) {
//     console.error("Error procesando el audio:", error);
//     res.status(500).send("Error procesando el audio.");
//   }
// });

// // Iniciar el servidor
// app.listen(3001, () => {
//   console.log("Agente de IA ejecutándose en http://localhost:3000");
// });



// require("dotenv").config();
// const express = require("express");
// const axios = require("axios");
// const { PrismaClient } = require("@prisma/client");
// const { HfInference } = require("@huggingface/inference");

// // Inicializar dependencias
// const app = express();
// const prisma = new PrismaClient();
// const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// app.use(express.json());

// const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

// // Resolver preguntas con Hugging Face
// async function questionAnswering(question, context) {
//   const response = await hf.request({
//     model: "distilbert-base-uncased-distilled-squad",
//     inputs: {
//       question: question,
//       context: context,
//     },
//   });
//   return { answer: response.answer, model: "Hugging Face - distilbert" };
// }

// // Resolver preguntas con ChatGPT
// async function respondWithChatGPT(question) {
//   const chatResponse = await axios.post(
//     "https://api.openai.com/v1/chat/completions",
//     {
//       model: "gpt-4",
//       messages: [{ role: "user", content: question }],
//     },
//     {
//       headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
//     }
//   );
//   return { answer: chatResponse.data.choices[0].message.content, model: "ChatGPT (GPT-3.5)" };
// }

// // Guardar interacción en la base de datos
// async function saveInteraction(question, answer, model) {
//   await prisma.interaction.create({
//     data: {
//       question,
//       answer: `${answer} (Respondido con: ${model})`,
//     },
//   });
// }

// // Recuperar interacciones previas relacionadas
// async function retrievePreviousInteractions(question) {
//   return await prisma.interaction.findMany({
//     where: {
//       question: { contains: question },
//     },
//     orderBy: { createdAt: "desc" },
//   });
// }

// // Procesar solicitud según palabras clave
// async function processRequest(input) {
//   if (input.toLowerCase().includes("gpt")) {
//     return await respondWithChatGPT(input);
//   } else if (input.toLowerCase().includes("accion")) {
//     return { action: true };
//   } else {
//     return await questionAnswering(input, "Información general para el agente de IA.");
//   }
// }

// // Endpoint principal
// app.post("/ask", async (req, res) => {
//   const { input } = req.body;

//   try {
//     let response;
//     let modelUsed;

//     // Procesar la solicitud según el contenido del parámetro "input"
//     const result = await processRequest(input);

//     if (result.action) {
//       // Si es una acción, activa Make webhook
//       await axios.post(MAKE_WEBHOOK_URL, {
//         accion: "realizar_accion",
//         details: {
//           input,
//           message: "Acción activada mediante palabra clave.",
//         },
//       });
//       res.json({ message: "Acción enviada a Make." });
//       return;
//     } else {
//       response = result.answer;
//       modelUsed = result.model;
//     }

//     // Guardar respuesta en la base de datos
//     await saveInteraction(input, response, modelUsed);

//     // Responder al cliente
//     res.json({
//       answer: `${response} (Respondido con: ${modelUsed})`,
//     });
//   } catch (error) {
//     console.error("Error procesando la pregunta:", error);
//     res.status(500).send("Error procesando la pregunta");
//   }
// });

// // Iniciar el servidor
// app.listen(3000, () => {
//   console.log("Agente de IA ejecutándose en http://localhost:3000");
// });


// require("dotenv").config();
// const express = require("express");
// const axios = require("axios");
// const { PrismaClient } = require("@prisma/client");
// const { HfInference } = require("@huggingface/inference");

// // Inicializar dependencias
// const app = express();
// const prisma = new PrismaClient();
// const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// app.use(express.json());

// const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

// // Resolver preguntas con Hugging Face
// async function questionAnswering(question, context) {
//   const response = await hf.request({
//     model: "distilbert-base-uncased-distilled-squad",
//     inputs: {
//       question: question,
//       context: context,
//     },
//   });
//   return { answer: response.answer, model: "Hugging Face - distilbert" };
// }

// // Resolver preguntas con ChatGPT
// async function respondWithChatGPT(question) {
//   const chatResponse = await axios.post(
//     "https://api.openai.com/v1/chat/completions",
//     {
//       model: "gpt-3.5",
//       messages: [{ role: "user", content: question }],
//     },
//     {
//       headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
//     }
//   );
//   return { answer: chatResponse.data.choices[0].message.content, model: "ChatGPT (GPT-3.5)" };
// }

// // Guardar interacción en la base de datos
// async function saveInteraction(question, answer, model) {
//   await prisma.interaction.create({
//     data: {
//       question,
//       answer: `${answer} (Respondido con: ${model})`,
//     },
//   });
// }

// // Recuperar interacciones previas relacionadas
// async function retrievePreviousInteractions(question) {
//   return await prisma.interaction.findMany({
//     where: {
//       question: { contains: question },
//     },
//     orderBy: { createdAt: "desc" },
//   });
// }

// // Endpoint principal
// app.post("/ask", async (req, res) => {
//   const { question } = req.body;

//   try {
//     // Buscar respuestas previas
//     const interactions = await retrievePreviousInteractions(question);
//     if (interactions.length > 0) {
//       res.json({
//         answer: `Respuestas previas: ${interactions.map((i) => i.answer).join("; ")}`,
//       });
//       return;
//     }

//     let response;
//     let modelUsed;

//     // Verificar si la pregunta pide específicamente usar ChatGPT
//     if (question.toLowerCase().includes("responder con chatgpt")) {
//       const chatGPTResponse = await respondWithChatGPT(question);
//       response = chatGPTResponse.answer;
//       modelUsed = chatGPTResponse.model;
//     } else {
//       // Usar Hugging Face para preguntas generales
//       const hfResponse = await questionAnswering(
//         question,
//         "Información general para el agente de IA."
//       );
//       response = hfResponse.answer;
//       modelUsed = hfResponse.model;
//     }

//     // Guardar respuesta en la base de datos
//     await saveInteraction(question, response, modelUsed);

//     // Responder al cliente
//     res.json({
//       answer: `${response} (Respondido con: ${modelUsed})`,
//     });

//     // Activar flujo en Make si es necesario
//     if (question.toLowerCase().includes("enviar correo")) {
//       await axios.post(MAKE_WEBHOOK_URL, {
//         action: "send_email",
//         details: {
//           subject: "Solicitud desde el agente",
//           content: response,
//         },
//       });
//     }
//   } catch (error) {
//     console.error("Error procesando la pregunta:", error);
//     res.status(500).send("Error procesando la pregunta");
//   }
// });

// // Iniciar el servidor
// app.listen(3000, () => {
//   console.log("Agente de IA ejecutándose en http://localhost:3000");
// });

// require("dotenv").config();
// const express = require("express");
// const axios = require("axios");
// const { PrismaClient } = require("@prisma/client");
// const { HfInference } = require("@huggingface/inference");

// // Inicializar dependencias
// const app = express();
// const prisma = new PrismaClient();
// const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

// app.use(express.json());

// const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

// // Resolver preguntas con Hugging Face
// async function questionAnswering(question, context) {
//   const response = await hf.request({
//     model: "distilbert-base-uncased-distilled-squad",
//     inputs: {
//       question: question,
//       context: context,
//     },
//   });
//   return { answer: response.answer, model: "Hugging Face - distilbert" };
// }

// // Resolver preguntas con ChatGPT
// async function respondWithChatGPT(question) {
//   const chatResponse = await axios.post(
//     "https://api.openai.com/v1/chat/completions",
//     {
//       model: "gpt-3.5",
//       messages: [{ role: "user", content: question }],
//     },
//     {
//       headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
//     }
//   );
//   return { answer: chatResponse.data.choices[0].message.content, model: "ChatGPT (GPT-3.5)" };
// }

// // Guardar interacción en la base de datos
// async function saveInteraction(question, answer, model) {
//   await prisma.interaction.create({
//     data: {
//       question,
//       answer: `${answer} (Respondido con: ${model})`,
//     },
//   });
// }

// // Recuperar interacciones previas relacionadas
// async function retrievePreviousInteractions(question) {
//   return await prisma.interaction.findMany({
//     where: {
//       question: { contains: question },
//     },
//     orderBy: { createdAt: "desc" },
//   });
// }

// // Endpoint principal
// app.post("/ask", async (req, res) => {
//   const { question } = req.body;

//   try {
//     // Buscar respuestas previas
//     const interactions = await retrievePreviousInteractions(question);
//     if (interactions.length > 0) {
//       res.json({
//         answer: `Respuestas previas: ${interactions.map((i) => i.answer).join("; ")}`,
//       });
//       return;
//     }

//     let response;
//     let modelUsed;

//     // Verificar si la pregunta pide específicamente usar ChatGPT
//     if (question.toLowerCase().includes("responder con chatgpt")) {
//       const chatGPTResponse = await respondWithChatGPT(question);
//       response = chatGPTResponse.answer;
//       modelUsed = chatGPTResponse.model;
//     } else {
//       // Usar Hugging Face para preguntas generales
//       const hfResponse = await questionAnswering(
//         question,
//         "Información general para el agente de IA."
//       );
//       response = hfResponse.answer;
//       modelUsed = hfResponse.model;
//     }

//     // Guardar respuesta en la base de datos
//     await saveInteraction(question, response, modelUsed);

//     // Responder al cliente
//     res.json({
//       answer: `${response} (Respondido con: ${modelUsed})`,
//     });

//     // Activar flujo en Make si es necesario
//     if (question.toLowerCase().includes("enviar correo")) {
//       await axios.post(MAKE_WEBHOOK_URL, {
//         action: "send_email",
//         details: {
//           subject: "Solicitud desde el agente",
//           content: response,
//         },
//       });
//     }
//   } catch (error) {
//     console.error("Error procesando la pregunta:", error);
//     res.status(500).send("Error procesando la pregunta");
//   }
// });

// // Iniciar el servidor
// app.listen(3000, () => {
//   console.log("Agente de IA ejecutándose en http://localhost:3000");
// });
