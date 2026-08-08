import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../prisma";
import { requireAuth } from "../middleware/auth";
import { sendPasswordResetEmail } from "../services/email";
import { generateQrCodeDataUrl, generateSecret, verifyToken } from "../services/totp";

export const authRouter = Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const RESET_TOKEN_TTL_HOURS = 1;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

function hashToken(rawToken: string) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
  totpToken: z.string().optional(),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
  }

  const { email, password, totpToken } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: "Credenciales inválidas" });

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return res.status(423).json({ error: `Cuenta bloqueada por intentos fallidos. Probá de nuevo en ${minutesLeft} min.` });
  }

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) {
    const attempts = user.failedLoginAttempts + 1;
    const lockingNow = attempts >= MAX_FAILED_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: lockingNow ? 0 : attempts,
        lockedUntil: lockingNow ? new Date(Date.now() + LOCKOUT_MINUTES * 60000) : null,
      },
    });
    if (lockingNow) {
      return res.status(423).json({ error: `Cuenta bloqueada por ${LOCKOUT_MINUTES} minutos tras demasiados intentos fallidos.` });
    }
    return res.status(401).json({ error: "Credenciales inválidas" });
  }

  if (user.twoFactorEnabled) {
    if (!totpToken) {
      return res.status(200).json({ requires2fa: true });
    }
    if (!(await verifyToken(totpToken, user.twoFactorSecret!))) {
      return res.status(401).json({ error: "Código de verificación inválido" });
    }
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });

  const token = jwt.sign(
    { userId: user.id, role: user.role, name: user.name },
    process.env.JWT_SECRET as string,
    { expiresIn: "12h" }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, role: user.role, email: user.email, twoFactorEnabled: user.twoFactorEnabled },
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, twoFactorEnabled: user.twoFactorEnabled });
});

/* ── Recuperación de contraseña ───────────────────────────────────────
 * La respuesta es siempre la misma exista o no el email, para no revelar
 * qué correos están registrados en el sistema.
 */

const forgotPasswordSchema = z.object({ email: z.email() });

authRouter.post("/forgot-password", async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000),
      },
    });
    const resetUrl = `${FRONTEND_URL}/reset-password?token=${rawToken}`;
    await sendPasswordResetEmail(user.email, resetUrl);
  }

  res.json({ message: "Si el correo está registrado, te enviamos instrucciones para restablecer la contraseña." });
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(6),
});

authRouter.post("/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const tokenHash = hashToken(parsed.data.token);
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    return res.status(400).json({ error: "El link de recuperación es inválido o expiró" });
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    }),
    prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
  ]);

  res.json({ message: "Contraseña actualizada correctamente" });
});

/* ── 2FA (TOTP) ────────────────────────────────────────────────────────
 * El secret se guarda en cuanto se pide el QR, pero twoFactorEnabled
 * queda en false hasta /2fa/verify — así nadie queda bloqueado de su
 * cuenta por vincular la app y no confirmar el primer código.
 */

authRouter.post("/2fa/setup", requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });

  // Si ya está activado, hay que pasar por /2fa/disable (que exige el
  // código actual) antes de poder pedir un secret nuevo — si no, alguien
  // con un JWT robado podría desactivar el 2FA sin conocer el código,
  // simplemente pisando el secret con uno nuevo vía este endpoint.
  if (user.twoFactorEnabled) {
    return res.status(400).json({ error: "El 2FA ya está activado. Desactivalo primero para volver a vincularlo." });
  }

  const secret = generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: secret, twoFactorEnabled: false } });

  const qrCodeDataUrl = await generateQrCodeDataUrl(user.email, secret);
  res.json({ qrCodeDataUrl, secret });
});

const totpSchema = z.object({ token: z.string().min(6).max(6) });

authRouter.post("/2fa/verify", requireAuth, async (req, res) => {
  const parsed = totpSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });
  if (!user.twoFactorSecret) return res.status(400).json({ error: "Primero pedí el código QR en /2fa/setup" });

  if (!(await verifyToken(parsed.data.token, user.twoFactorSecret))) {
    return res.status(400).json({ error: "Código inválido" });
  }

  await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
  res.json({ ok: true });
});

authRouter.post("/2fa/disable", requireAuth, async (req, res) => {
  const parsed = totpSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.userId } });
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    return res.status(400).json({ error: "El 2FA no está activado" });
  }
  if (!(await verifyToken(parsed.data.token, user.twoFactorSecret))) {
    return res.status(400).json({ error: "Código inválido" });
  }

  await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
  res.json({ ok: true });
});
