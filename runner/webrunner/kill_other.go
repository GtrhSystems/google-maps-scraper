//go:build !linux

package webrunner

// killDescendants no hace nada fuera de Linux: ahí no hay /proc para encontrar
// los procesos hijos (el programa se ejecuta en Docker o WSL).
func killDescendants() {}
