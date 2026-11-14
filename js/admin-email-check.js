import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-functions.js";

export async function isAdminEmail(app, email) {
    if (!app || typeof email !== "string") {
        return false;
    }

    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
        return false;
    }

    const functions = getFunctions(app);
    const checkAdminEmail = httpsCallable(functions, "isAdminEmail");

    try {
        const result = await checkAdminEmail({ email: normalizedEmail });
        return result?.data?.isAdmin === true;
    } catch (error) {
        console.warn("Admin email check failed.", error);
        return false;
    }
}
