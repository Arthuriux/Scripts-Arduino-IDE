#include "BluetoothSerial.h"
BluetoothSerial SerialBT;
const int pinReceive1 = 27;
const int pinReceive2 = 15;
// Pines del motor A
int ENA = 25;
int IN1 = 33;
int IN2 = 32;
// Pines del motor B
int IN3 = 18;
int IN4 = 19;
int ENB = 21;
bool motorA_encendido = false;
bool motorB_encendido = false;
bool motorA_encendido_bluetooth = false;
bool motorA_apagado_bluetooth = false;
bool motorB_encendido_bluetooth = false;
bool motorB_apagado_bluetooth = false;
struct DatosSensores {
  int temperatura;
  int humedad;
};
void setup() {
  Serial.begin(9600);
  SerialBT.begin("ESP32_BT");
  pinMode(pinReceive1, INPUT);
  pinMode(pinReceive2, INPUT);
  // Configurar pines del motor A como salida
  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  // Configurar pines del motor B como salida
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  pinMode(ENB, OUTPUT);
  delay(1000);
}
void loop() {
  DatosSensores Esclavo1 = recibirConjunto(pinReceive1, "Esclavo 1");
  DatosSensores Esclavo2 = recibirConjunto(pinReceive2, "Esclavo 2");
  Serial.print("Esclavo 1:");
  Serial.print(" - Temp: ");
  Serial.print(Esclavo1.temperatura);
  Serial.print(", Hum: ");
  Serial.println(Esclavo1.humedad);
  Serial.print("Esclavo 2: ");
  Serial.print(" - Temp: ");
  Serial.print(Esclavo2.temperatura);
  Serial.print(", Hum: ");
  Esclavo2.humedad = Esclavo2.humedad-64;
  Serial.println(Esclavo2.humedad);
  controlarMotores(Esclavo1.temperatura, Esclavo2.temperatura);
  enviarDatosBluetooth(Esclavo1.temperatura, Esclavo1.humedad, Esclavo2.temperatura, Esclavo2.humedad);
  recibirComandos();
}
void enviarDatosBluetooth(int temp1, int hum1, int temp2, int hum2) {
  String datos = String(temp1) + "," + String(hum1) + "," + String(temp2) + "," + String(hum2);
  SerialBT.println(datos);
}
DatosSensores recibirConjunto(int pin, const char* nombreConjunto) {
  // Recibir inicio de transmisión
  while (digitalRead(pin) == HIGH);
  delayMicroseconds(100);
  // Recibir el primer valor
  int temperatura = recibirValor(pin);
  // Recibir el segundo valor
  int humedad = recibirValor(pin);
  // Recibir final de transmisión
  while (digitalRead(pin) == LOW);
  delay(500);  // Esperar un segundo antes de recibir el siguiente conjunto de números
  DatosSensores datos;
  datos.temperatura = temperatura;
  datos.humedad = humedad;
  return datos;
}
int recibirValor(int pin) {
  int valorRecibido = 0;
  // Recibir 8 bits de datos
  for (int i = 0; i < 8; i++) {
    delayMicroseconds(100);
    valorRecibido |= (digitalRead(pin) << i);
  }
  return valorRecibido;
}
void controlarMotores(int temperatura1, int temperatura2) {
  // Prioridad a los comandos Bluetooth
  if (motorA_encendido_bluetooth) {
    Serial.println("Motor A: Encendido Bluetooth");
    encenderMotorA();
  } else if (motorA_apagado_bluetooth) {
    Serial.println("Motor A: Apagado Bluetooth");
    apagarMotorA();
  } else {
    // Controlar el motor A basado en la temperatura
    if (temperatura1 > 22) {
      encenderMotorA();
      Serial.println("Motor A: Encendido");
    } else {
      apagarMotorA();
      Serial.println("Motor A: Apagado");
    }
  }
  // Prioridad a los comandos Bluetooth
  if (motorB_encendido_bluetooth) {
    Serial.println("Motor B: Encendido Bluetooth");
    encenderMotorB();
  } else if (motorB_apagado_bluetooth) {
    Serial.println("Motor B: Apagado Bluetooth");
    apagarMotorB();
  } else {
    // Controlar el motor B basado en la temperatura
    if (temperatura2 > 22) {
      encenderMotorB();
      Serial.println("Motor B: Encendido");
    } else {
      apagarMotorB();
      Serial.println("Motor B: Apagado");
    }
  }
}
void encenderMotorA() {
  if (!motorA_encendido) {
    digitalWrite(IN1, HIGH);
    digitalWrite(IN2, LOW);
    analogWrite(ENA, 255);
    motorA_encendido = true;
  }
}
void apagarMotorA() {
  if (motorA_encendido) {
    for (int i = 255; i >= 0; i -= 5) {
      analogWrite(ENA, i);
      delayMicroseconds(500);
    }
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, LOW);
    analogWrite(ENA, 0);
    motorA_encendido = false;
  }
}
void encenderMotorB() {
  if (!motorB_encendido) {
    digitalWrite(IN3, HIGH);
    digitalWrite(IN4, LOW);
    analogWrite(ENB, 255);
    motorB_encendido = true;
  }
}
void apagarMotorB() {
  if (motorB_encendido) {
    for (int i = 255; i >= 0; i -= 5) {
      analogWrite(ENB, i);
      delayMicroseconds(500);
    }
    digitalWrite(IN3, LOW);
    digitalWrite(IN4, LOW);
    analogWrite(ENB, 0);
    motorB_encendido = false;
  }
}
void recibirComandos() {
  if (SerialBT.available()) {
    // Si hay datos disponibles en el Bluetooth, leer el comando
    String comando = SerialBT.readStringUntil('\n');
    procesarComandoBluetooth(comando);
    Serial.print ("Comando recibido por bluetooth: ");
    Serial.println(comando);
  }
}
void procesarComandoBluetooth(String comando) {
  if (comando == "AON") {
    Serial.println("AON BLUETOOTH");
    motorA_encendido_bluetooth = true;
    motorA_apagado_bluetooth = false;
  } else if (comando == "AOFF") {
    Serial.println("AOFF BLUETOOTH");
    motorA_encendido_bluetooth = false;
    motorA_apagado_bluetooth = true;
  } else if (comando == "BON") {
    Serial.println("BON BLUETOOTH");
    motorB_encendido_bluetooth = true;
    motorB_apagado_bluetooth = false;
  } else if (comando == "BOFF") {
    Serial.println("BOFF BLUETOOTH");
    motorB_encendido_bluetooth = false;
    motorB_apagado_bluetooth = true;
  }
}
