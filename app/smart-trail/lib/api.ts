import axios from "axios";

const api = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.response.use(
  (response) => response,
  (err) => {
    if (!err.response) {
      err.response = { data: { status: "error", code: "NETWORK_ERROR" } };
    } else if (err.response.status === 504 || err.response.status === 503) {
      err.response.data = { status: "error", code: "GATEWAY_TIMEOUT" };
    }
    return Promise.reject(err);
  },
);

export default api;
