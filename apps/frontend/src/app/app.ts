import { HttpClient } from '@angular/common/http';
import { Component, OnInit, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { environment } from '../environments/environment';
import { NxWelcome } from './nx-welcome';

@Component({
  imports: [NxWelcome, RouterModule],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
    protected title = 'frontend';
  protected apiStatus = signal<string>('Checking API connection...');

  constructor(private http: HttpClient) {}

  ngOnInit():void {
    this.http.get<{ message: string }>(environment.apiUrl).subscribe({
      next: (res) => this.apiStatus.set(`API connected: "${res.message}"`),
      error: (err) =>
        this.apiStatus.set(`API connection failed: ${err.message}`),
    });
  }
}
