#!/usr/bin/env bash
echo "inicio"
sudo systemctl daemon-reload

echo "Actualizado"
sudo systemctl restart subir-video
sudo systemctl status subir-video
